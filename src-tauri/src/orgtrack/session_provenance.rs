//! Session-to-resource provenance ingestion.
//!
//! External hooks are intentionally split into two processes:
//! 1. the lightweight hook invocation normalizes vendor JSON and atomically
//!    writes privacy-filtered envelopes to an inbox;
//! 2. the desktop process drains that inbox and performs canonical DB writes.
//!
//! This keeps hooks fast, avoids SQLite contention, and ensures raw prompts,
//! tool responses, commands, and file contents never enter the spool.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use core_types::activity::ActivityChunk;
use core_types::extracted::ExtractedData;
use core_types::session_event::{EventDisplayStatus, SessionEvent};
use database::db::get_connection;
use orgtrack_core::activity_interaction::{
    activity_chunk_source_event_id, file_interactions_from_activity_chunk,
    interaction_outcome_from_activity_chunk,
};
use orgtrack_core::canonical::{
    AgentMetadata, AttributionPrecision, FileResourceRecord, ResourceAction,
    ResourceInteractionCaptureMethod, ResourceInteractionEnvelopeV1, ResourceInteractionOutcome,
    ResourceInteractionRecord, SessionRecord, RESOURCE_INTERACTION_SCHEMA_VERSION,
    SOURCE_ORGII_CLI_SESSIONS, SOURCE_ORGII_RUST_AGENTS,
};
use orgtrack_core::hook_adapter::{normalize_hook_payload, HookSource};
use orgtrack_core::privacy::ORGTRACK_SCHEMA_VERSION;
use orgtrack_core::repo_sync::paths::{path_hash, record_id};
use orgtrack_core::sources::claude_code::history::{
    list_claude_code_history_sessions_paginated, load_claude_code_history_for_session,
};
use orgtrack_core::sources::codex::app::{
    list_codex_app_sessions_paginated, load_codex_app_for_session,
};
use orgtrack_core::sources::cursor_ide::history::{
    list_cursor_ide_sessions_paginated, load_history_for_session as load_cursor_history_for_session,
};
use orgtrack_core::sources::imported_history::cache::{
    query_cached_sessions_for_repo_from_conn, ImportedHistoryCachedSession,
};
use orgtrack_core::sources::imported_history::metadata::{
    SOURCE_CLAUDE_CODE, SOURCE_CODEX_APP, SOURCE_CURSOR_IDE,
};
use orgtrack_core::store::{sqlite::SqliteRecordStore, RecordStore};
use rusqlite::Connection;
use session_persistence::CachedEvent;

const MAX_HOOK_PAYLOAD_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DRAIN_BATCH: usize = 1_000;
const HISTORICAL_INTERACTION_PARSER_VERSION: i64 = 1;
const BACKFILL_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const BACKFILL_JOB_RETENTION: Duration = Duration::from_secs(60 * 60);
static INBOX_DRAIN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static HISTORICAL_BACKFILL_JOBS: OnceLock<Mutex<HashMap<String, HistoricalBackfillJob>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
struct HistoricalBackfillJob {
    status: HistoricalBackfillStatus,
    indexed_sessions: usize,
    total_sessions: usize,
    failed_sessions: usize,
    last_error: Option<String>,
    finished_at: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HistoricalBackfillStatus {
    Queued,
    Discovering,
    Indexing,
    Complete,
    Partial,
    Failed,
}

impl HistoricalBackfillStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Discovering => "discovering",
            Self::Indexing => "indexing",
            Self::Complete => "complete",
            Self::Partial => "partial",
            Self::Failed => "failed",
        }
    }
}

impl HistoricalBackfillJob {
    fn queued() -> Self {
        Self {
            status: HistoricalBackfillStatus::Queued,
            indexed_sessions: 0,
            total_sessions: 0,
            failed_sessions: 0,
            last_error: None,
            finished_at: None,
        }
    }

    fn snapshot(&self) -> super::types::FileSessionHistoryBackfill {
        super::types::FileSessionHistoryBackfill {
            status: self.status.as_str().to_string(),
            indexed_sessions: self.indexed_sessions,
            total_sessions: self.total_sessions,
            failed_sessions: self.failed_sessions,
            last_error: self.last_error.clone(),
        }
    }

    fn is_active(&self) -> bool {
        matches!(
            self.status,
            HistoricalBackfillStatus::Queued
                | HistoricalBackfillStatus::Discovering
                | HistoricalBackfillStatus::Indexing
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedFileResource {
    pub repository_id: Option<String>,
    pub workspace_path: String,
    pub repo_relative_path: String,
    pub display_path: String,
}

/// Entry point used by `orgii --session-provenance-hook <source>`.
///
/// Hook failures are returned to the caller for diagnostics, but `main` exits
/// successfully so provenance can never block the agent tool invocation.
pub fn capture_hook_stdin(source: &str) -> Result<usize, String> {
    let source = HookSource::parse(source)?;
    let mut stdin = std::io::stdin().take(MAX_HOOK_PAYLOAD_BYTES + 1);
    let mut payload = Vec::new();
    stdin
        .read_to_end(&mut payload)
        .map_err(|err| format!("Failed to read session-provenance hook input: {err}"))?;
    if payload.len() as u64 > MAX_HOOK_PAYLOAD_BYTES {
        return Err(format!(
            "Session-provenance hook input exceeds {MAX_HOOK_PAYLOAD_BYTES} bytes"
        ));
    }
    let payload: serde_json::Value = serde_json::from_slice(&payload)
        .map_err(|err| format!("Invalid session-provenance hook JSON: {err}"))?;
    let envelopes = normalize_hook_payload(source, &payload)?;
    for envelope in &envelopes {
        spool_envelope(envelope)?;
    }
    Ok(envelopes.len())
}

fn spool_envelope(envelope: &ResourceInteractionEnvelopeV1) -> Result<(), String> {
    envelope
        .validate()
        .map_err(|err| format!("Invalid resource-interaction envelope: {err}"))?;
    let inbox = app_paths::session_provenance_inbox_dir();
    fs::create_dir_all(&inbox)
        .map_err(|err| format!("Failed to create {}: {err}", inbox.display()))?;
    let action = envelope.action.as_str();
    let identity = record_id(&[
        &envelope.source,
        &envelope.session_id,
        envelope.source_event_id.as_deref().unwrap_or(""),
        &envelope.file_path,
        action,
        &envelope.occurred_at,
    ]);
    let path = inbox.join(format!("{identity}.json"));
    if path.exists() {
        return Ok(());
    }

    let bytes = serde_json::to_vec(envelope)
        .map_err(|err| format!("Failed to serialize session-provenance envelope: {err}"))?;
    let temp_path = inbox.join(format!(".{identity}.{}.tmp", std::process::id()));
    fs::write(&temp_path, bytes)
        .map_err(|err| format!("Failed to write {}: {err}", temp_path.display()))?;
    app_paths::set_sensitive_file_permissions(&temp_path).ok();
    match fs::rename(&temp_path, &path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            let _ = fs::remove_file(&temp_path);
            Ok(())
        }
        Err(err) => {
            let _ = fs::remove_file(&temp_path);
            Err(format!("Failed to publish {}: {err}", path.display()))
        }
    }
}

/// Drain a bounded number of hook envelopes into the canonical store.
///
/// Malformed/version-incompatible files are quarantined by deletion because
/// the hook never stores raw source data and the same source event can be
/// emitted again. Database failures leave the current and remaining files in
/// place for the next drain.
pub fn drain_hook_inbox() -> Result<usize, String> {
    let _guard = INBOX_DRAIN_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Session-provenance inbox drain lock is poisoned".to_string())?;
    let inbox = app_paths::session_provenance_inbox_dir();
    if !inbox.exists() {
        return Ok(0);
    }
    let mut files = fs::read_dir(&inbox)
        .map_err(|err| format!("Failed to read {}: {err}", inbox.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect::<Vec<_>>();
    files.sort();
    files.truncate(MAX_DRAIN_BATCH);

    let conn = get_connection().map_err(|err| err.to_string())?;
    let store = SqliteRecordStore::new(&conn);
    let mut drained = 0;
    for path in files {
        let envelope = match fs::read(&path)
            .map_err(|err| err.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<ResourceInteractionEnvelopeV1>(&bytes)
                    .map_err(|err| err.to_string())
            })
            .and_then(|envelope| {
                envelope
                    .validate()
                    .map_err(|err| err.to_string())
                    .map(|()| envelope)
            }) {
            Ok(envelope) => envelope,
            Err(_) => {
                let _ = fs::remove_file(&path);
                continue;
            }
        };
        persist_envelope(&store, &envelope)?;
        fs::remove_file(&path).map_err(|err| {
            format!(
                "Failed to remove drained envelope {}: {err}",
                path.display()
            )
        })?;
        drained += 1;
    }
    Ok(drained)
}

pub fn persist_envelope(
    store: &dyn RecordStore,
    envelope: &ResourceInteractionEnvelopeV1,
) -> Result<(), String> {
    if store.get_session(&envelope.session_id)?.is_none() {
        store.upsert_session(&SessionRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            source: envelope.source.clone(),
            source_session_id: envelope.source_session_id.clone(),
            session_id: envelope.session_id.clone(),
            title: envelope.source_session_id.clone(),
            status: None,
            created_at: Some(envelope.occurred_at.clone()),
            updated_at: Some(envelope.occurred_at.clone()),
            completed_at: None,
            workspace_path: Some(envelope.cwd.clone()),
            branch: None,
            parent_session_id: None,
            // Actor/subagent identity belongs to the interaction. It must not
            // be promoted to session-level org membership.
            org_member_id: None,
            metadata: AgentMetadata {
                origin: Some("session_provenance_hook".to_string()),
                ..AgentMetadata::default()
            },
        })?;
    }

    persist_file_interaction(
        store,
        &envelope.source,
        Some(&envelope.source_session_id),
        &envelope.session_id,
        envelope.source_event_id.as_deref(),
        envelope.turn_id.as_deref(),
        envelope.actor_id.as_deref(),
        &envelope.cwd,
        &envelope.file_path,
        envelope.action,
        envelope.outcome,
        &envelope.occurred_at,
        ResourceInteractionCaptureMethod::Hook,
        envelope.attribution_precision,
    )
}

/// Persist the native ORG2 event representation after its tool result has
/// merged into the tool-call event. This captures reads as well as writes and
/// preserves exact child-session attribution when the runtime exposes it.
pub fn persist_native_event_interactions(
    store: &dyn RecordStore,
    session: &SessionRecord,
    event: &SessionEvent,
) -> Result<(), String> {
    let mut path_actions = match event.extracted.as_ref() {
        Some(ExtractedData::File(file)) => {
            vec![(file.file_path.clone(), ResourceAction::Read)]
        }
        Some(ExtractedData::Edit(edit)) if !edit.apply_patch_segments.is_empty() => edit
            .apply_patch_segments
            .iter()
            .map(|segment| {
                (
                    segment.file_path.clone(),
                    if segment.is_deleted {
                        ResourceAction::Delete
                    } else {
                        ResourceAction::Write
                    },
                )
            })
            .collect(),
        Some(ExtractedData::Edit(edit)) => vec![(
            edit.file_path.clone(),
            if edit.is_deleted {
                ResourceAction::Delete
            } else {
                ResourceAction::Write
            },
        )],
        Some(ExtractedData::DeleteFile(file)) => {
            vec![(file.file_path.clone(), ResourceAction::Delete)]
        }
        Some(ExtractedData::Search(search)) => search
            .results
            .iter()
            .map(|result| (result.file.clone(), ResourceAction::Search))
            .collect(),
        _ => Vec::new(),
    };
    path_actions.retain(|(path, _)| !path.trim().is_empty());
    path_actions.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.as_str().cmp(right.1.as_str()))
    });
    path_actions.dedup();

    let workspace_path = event
        .repo_path
        .as_deref()
        .or(session.workspace_path.as_deref())
        .unwrap_or(".");
    let actor_id = session.org_member_id.as_deref().or_else(|| {
        session
            .parent_session_id
            .as_ref()
            .map(|_| session.session_id.as_str())
    });
    let precision = if actor_id.is_some() {
        AttributionPrecision::Exact
    } else {
        AttributionPrecision::SessionOnly
    };
    let outcome = if event.display_status == EventDisplayStatus::Failed {
        ResourceInteractionOutcome::Failed
    } else {
        ResourceInteractionOutcome::Succeeded
    };

    for (file_path, action) in path_actions {
        let source_event_base = event
            .result
            .get("call_id")
            .or_else(|| event.result.get("callId"))
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&event.id);
        let source_event_id = format!("{source_event_base}:{}:{file_path}", action.as_str());
        persist_file_interaction(
            store,
            &session.source,
            Some(&session.source_session_id),
            &session.session_id,
            Some(&source_event_id),
            event.thread_id.as_deref(),
            actor_id,
            workspace_path,
            &file_path,
            action,
            outcome,
            &event.created_at,
            ResourceInteractionCaptureMethod::Native,
            precision,
        )?;
    }
    Ok(())
}

/// Start (or join) one repository-scoped historical transcript backfill.
///
/// The file-history read path only schedules this work. Source discovery and
/// transcript parsing run on a dedicated blocking thread, so opening a file is
/// never held hostage by the size of the user's history. Per-session source
/// fingerprints in SQLite are the durable queue: after a crash or restart the
/// next request skips current checkpoints and resumes only stale sessions.
pub fn request_historical_backfill(
    repo_path: &str,
    priority_file: &str,
) -> super::types::FileSessionHistoryBackfill {
    let canonical_repo = canonicalize_existing_prefix(Path::new(repo_path));
    let repo_key = canonical_repo.to_string_lossy().into_owned();
    let jobs = HISTORICAL_BACKFILL_JOBS.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let mut jobs = jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        jobs.retain(|key, job| {
            key == &repo_key
                || job.is_active()
                || job
                    .finished_at
                    .is_some_and(|finished_at| finished_at.elapsed() < BACKFILL_JOB_RETENTION)
        });
        if let Some(job) = jobs.get(&repo_key) {
            let recently_finished = job
                .finished_at
                .is_some_and(|finished_at| finished_at.elapsed() < BACKFILL_REFRESH_INTERVAL);
            if job.is_active() || recently_finished {
                return job.snapshot();
            }
        }
        jobs.insert(repo_key.clone(), HistoricalBackfillJob::queued());
    }

    let thread_repo_key = repo_key.clone();
    let thread_repo_path = canonical_repo.to_string_lossy().into_owned();
    let priority_file = priority_file.to_string();
    let spawn_result = std::thread::Builder::new()
        .name("orgtrack-history-backfill".to_string())
        .spawn(move || {
            update_backfill_job(&thread_repo_key, |job| {
                job.status = HistoricalBackfillStatus::Discovering;
            });
            let result = get_connection()
                .map_err(|err| err.to_string())
                .and_then(|mut conn| {
                    reconcile_historical_interactions(
                        &mut conn,
                        &thread_repo_path,
                        &priority_file,
                        |indexed_sessions, total_sessions, failed_sessions| {
                            update_backfill_job(&thread_repo_key, |job| {
                                job.status = HistoricalBackfillStatus::Indexing;
                                job.indexed_sessions = indexed_sessions;
                                job.total_sessions = total_sessions;
                                job.failed_sessions = failed_sessions;
                            });
                        },
                    )
                });
            match result {
                Ok(()) => update_backfill_job(&thread_repo_key, |job| {
                    job.status = if job.failed_sessions > 0 {
                        HistoricalBackfillStatus::Partial
                    } else {
                        HistoricalBackfillStatus::Complete
                    };
                    job.finished_at = Some(Instant::now());
                }),
                Err(err) => {
                    tracing::warn!(
                        repo_path = %thread_repo_path,
                        error = %err,
                        "[SessionProvenance] Historical backfill failed"
                    );
                    update_backfill_job(&thread_repo_key, |job| {
                        job.status = HistoricalBackfillStatus::Failed;
                        job.last_error = Some(err.clone());
                        job.finished_at = Some(Instant::now());
                    });
                }
            }
        });
    if let Err(err) = spawn_result {
        update_backfill_job(&repo_key, |job| {
            job.status = HistoricalBackfillStatus::Failed;
            job.last_error = Some(format!("Failed to start historical backfill: {err}"));
            job.finished_at = Some(Instant::now());
        });
    }

    let jobs = jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    jobs.get(&repo_key)
        .map(HistoricalBackfillJob::snapshot)
        .unwrap_or_else(|| HistoricalBackfillJob::queued().snapshot())
}

fn update_backfill_job(repo_key: &str, update: impl FnOnce(&mut HistoricalBackfillJob)) {
    let jobs = HISTORICAL_BACKFILL_JOBS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut jobs = jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    update(
        jobs.entry(repo_key.to_string())
            .or_insert_with(HistoricalBackfillJob::queued),
    );
}

fn reconcile_historical_interactions(
    conn: &mut Connection,
    repo_path: &str,
    priority_file: &str,
    mut progress: impl FnMut(usize, usize, usize),
) -> Result<(), String> {
    let canonical_repo = canonicalize_existing_prefix(Path::new(repo_path));
    let mut discovery_failures = sync_imported_history_caches(conn);

    let mut imported_batches = Vec::new();
    for source in [SOURCE_CLAUDE_CODE, SOURCE_CODEX_APP, SOURCE_CURSOR_IDE] {
        match imported_sessions_for_repo(conn, source, repo_path, &canonical_repo) {
            Ok(mut sessions) => {
                sessions.sort_by_key(|session| {
                    !session_touches_priority_file(session, &canonical_repo, priority_file)
                });
                imported_batches.push((source, sessions));
            }
            Err(err) => {
                discovery_failures += 1;
                tracing::warn!(
                    source,
                    error = %err,
                    "[SessionProvenance] Historical source discovery failed"
                );
            }
        }
    }
    let native_sessions = native_sessions_for_repo(conn, repo_path, &canonical_repo)?;
    let total_sessions = imported_batches
        .iter()
        .map(|(_, sessions)| sessions.len())
        .sum::<usize>()
        + native_sessions.len()
        + discovery_failures;
    let mut indexed_sessions = 0;
    let mut failed_sessions = discovery_failures;
    progress(indexed_sessions, total_sessions, failed_sessions);

    for (source, sessions) in imported_batches {
        for session in sessions {
            match reconcile_imported_session(conn, source, &canonical_repo, &session) {
                Ok(()) => indexed_sessions += 1,
                Err(err) => {
                    failed_sessions += 1;
                    tracing::warn!(
                        source,
                        session_id = %session.session_id,
                        error = %err,
                        "[SessionProvenance] Historical session reconciliation failed"
                    );
                }
            }
            progress(indexed_sessions, total_sessions, failed_sessions);
        }
    }
    for session in native_sessions {
        match reconcile_native_session(conn, &canonical_repo, &session) {
            Ok(()) => indexed_sessions += 1,
            Err(err) => {
                failed_sessions += 1;
                tracing::warn!(
                    session_id = %session.session_id,
                    error = %err,
                    "[SessionProvenance] Native historical session reconciliation failed"
                );
            }
        }
        progress(indexed_sessions, total_sessions, failed_sessions);
    }
    Ok(())
}

fn sync_imported_history_caches(conn: &mut Connection) -> usize {
    let mut failures = 0;
    if let Err(err) = list_claude_code_history_sessions_paginated(conn, 1, 0) {
        failures += 1;
        tracing::warn!(error = %err, "[SessionProvenance] Claude history discovery failed");
    }
    if let Err(err) = list_codex_app_sessions_paginated(conn, 1, 0) {
        failures += 1;
        tracing::warn!(error = %err, "[SessionProvenance] Codex history discovery failed");
    }
    if let Err(err) = list_cursor_ide_sessions_paginated(conn, 1, 0) {
        failures += 1;
        tracing::warn!(error = %err, "[SessionProvenance] Cursor history discovery failed");
    }
    failures
}

fn imported_sessions_for_repo(
    conn: &Connection,
    source: &str,
    repo_path: &str,
    canonical_repo: &Path,
) -> Result<Vec<ImportedHistoryCachedSession>, String> {
    let canonical_repo_str = canonical_repo.to_string_lossy();
    let mut sessions_by_id = std::collections::BTreeMap::new();
    for candidate in [repo_path, canonical_repo_str.as_ref()] {
        for session in query_cached_sessions_for_repo_from_conn(conn, source, candidate)? {
            sessions_by_id.insert(session.session_id.clone(), session);
        }
    }
    Ok(sessions_by_id.into_values().collect())
}

fn session_touches_priority_file(
    session: &ImportedHistoryCachedSession,
    canonical_repo: &Path,
    priority_file: &str,
) -> bool {
    let priority_file = priority_file
        .trim_start_matches(['/', '\\'])
        .replace('\\', "/");
    session.impact.touched_files.iter().any(|candidate| {
        let candidate_path = Path::new(candidate);
        let relative = candidate_path
            .strip_prefix(canonical_repo)
            .unwrap_or(candidate_path)
            .to_string_lossy()
            .trim_start_matches(['/', '\\'])
            .replace('\\', "/");
        relative == priority_file
    })
}

fn reconcile_imported_session(
    conn: &Connection,
    source: &str,
    canonical_repo: &Path,
    session: &ImportedHistoryCachedSession,
) -> Result<(), String> {
    let store = SqliteRecordStore::new(conn);
    let fingerprint = imported_session_fingerprint(session);
    if store.interaction_import_is_current(
        source,
        &session.session_id,
        &fingerprint,
        HISTORICAL_INTERACTION_PARSER_VERSION,
    )? {
        return Ok(());
    }
    let chunks = match source {
        SOURCE_CLAUDE_CODE => load_claude_code_history_for_session(conn, &session.session_id),
        SOURCE_CODEX_APP => load_codex_app_for_session(conn, &session.session_id),
        SOURCE_CURSOR_IDE => load_cursor_history_for_session(&session.session_id),
        _ => return Err(format!("Unsupported imported history source: {source}")),
    }?;
    store.delete_reconciled_resource_interactions(source, &session.session_id)?;
    let actor_id = session
        .parent_session_id
        .as_ref()
        .map(|_| session.source_session_id.as_str());
    let precision = if actor_id.is_some() {
        AttributionPrecision::Exact
    } else {
        AttributionPrecision::SessionOnly
    };
    persist_activity_chunks(
        &store,
        source,
        Some(&session.source_session_id),
        &session.session_id,
        actor_id,
        session
            .repo_path
            .as_deref()
            .or_else(|| canonical_repo.to_str())
            .unwrap_or("."),
        precision,
        &chunks,
    )?;
    store.mark_interaction_imported(
        source,
        &session.session_id,
        &fingerprint,
        HISTORICAL_INTERACTION_PARSER_VERSION,
        &Utc::now().to_rfc3339(),
    )
}

fn imported_session_fingerprint(session: &ImportedHistoryCachedSession) -> String {
    format!(
        "{}:{}:{}:{}",
        session.source_mtime_ms,
        session.source_size_bytes,
        session.source_fingerprint,
        session.parser_version
    )
}

fn native_sessions_for_repo(
    conn: &Connection,
    repo_path: &str,
    canonical_repo: &Path,
) -> Result<Vec<SessionRecord>, String> {
    let store = SqliteRecordStore::new(conn);
    let canonical_repo_str = canonical_repo.to_string_lossy();
    let mut sessions_by_id = std::collections::BTreeMap::new();
    for candidate in [repo_path, canonical_repo_str.as_ref()] {
        for session in store.list_sessions(Some(candidate))? {
            sessions_by_id.insert(session.session_id.clone(), session);
        }
    }
    Ok(sessions_by_id
        .into_values()
        .filter(|session| {
            matches!(
                session.source.as_str(),
                SOURCE_ORGII_RUST_AGENTS | SOURCE_ORGII_CLI_SESSIONS
            ) && session.workspace_path.as_deref().is_some_and(|workspace| {
                canonicalize_existing_prefix(Path::new(workspace)) == canonical_repo
            })
        })
        .collect())
}

fn reconcile_native_session(
    conn: &Connection,
    canonical_repo: &Path,
    session: &SessionRecord,
) -> Result<(), String> {
    let Some(metadata) = session_persistence::get_session_metadata(&session.session_id)
        .map_err(|err| err.to_string())?
    else {
        // A live-only session may not have a persisted event cache. It has
        // still been fully considered for coverage and is not a failure.
        return Ok(());
    };
    let fingerprint = format!(
        "{}:{}:{}:{}",
        metadata.event_count,
        metadata.cached_at,
        metadata.time_range_start.as_deref().unwrap_or_default(),
        metadata.time_range_end.as_deref().unwrap_or_default()
    );
    let store = SqliteRecordStore::new(conn);
    if store.interaction_import_is_current(
        &session.source,
        &session.session_id,
        &fingerprint,
        HISTORICAL_INTERACTION_PARSER_VERSION,
    )? {
        return Ok(());
    }
    let events =
        session_persistence::load_events(&session.session_id).map_err(|err| err.to_string())?;
    let chunks = events
        .iter()
        .map(cached_event_to_activity_chunk)
        .collect::<Vec<_>>();
    let actor_id = session.org_member_id.as_deref().or_else(|| {
        session
            .parent_session_id
            .as_ref()
            .map(|_| session.source_session_id.as_str())
    });
    let precision = if actor_id.is_some() {
        AttributionPrecision::Exact
    } else {
        AttributionPrecision::SessionOnly
    };
    store.delete_reconciled_resource_interactions(&session.source, &session.session_id)?;
    persist_activity_chunks(
        &store,
        &session.source,
        Some(&session.source_session_id),
        &session.session_id,
        actor_id,
        session
            .workspace_path
            .as_deref()
            .or_else(|| canonical_repo.to_str())
            .unwrap_or("."),
        precision,
        &chunks,
    )?;
    store.mark_interaction_imported(
        &session.source,
        &session.session_id,
        &fingerprint,
        HISTORICAL_INTERACTION_PARSER_VERSION,
        &Utc::now().to_rfc3339(),
    )
}

#[allow(clippy::too_many_arguments)]
fn persist_activity_chunks(
    store: &dyn RecordStore,
    source: &str,
    source_session_id: Option<&str>,
    session_id: &str,
    actor_id: Option<&str>,
    workspace_path: &str,
    precision: AttributionPrecision,
    chunks: &[ActivityChunk],
) -> Result<usize, String> {
    let mut persisted = 0;
    for chunk in chunks {
        let outcome = interaction_outcome_from_activity_chunk(chunk);
        for interaction in file_interactions_from_activity_chunk(chunk) {
            let source_event_id = activity_chunk_source_event_id(chunk, &interaction);
            persist_file_interaction(
                store,
                source,
                source_session_id,
                session_id,
                Some(&source_event_id),
                chunk.thread_id.as_deref(),
                actor_id,
                workspace_path,
                &interaction.file_path,
                interaction.action,
                outcome,
                &chunk.created_at,
                ResourceInteractionCaptureMethod::Reconciled,
                precision,
            )?;
            persisted += 1;
        }
    }
    Ok(persisted)
}

fn cached_event_to_activity_chunk(event: &CachedEvent) -> ActivityChunk {
    ActivityChunk {
        chunk_id: event.id.clone(),
        session_id: event.session_id.clone(),
        action_type: event.event_type.clone(),
        function: event.function_name.clone().unwrap_or_default(),
        args: serde_json::from_str(&event.args_json).unwrap_or(serde_json::Value::Null),
        result: serde_json::from_str(&event.result_json).unwrap_or(serde_json::Value::Null),
        created_at: event.created_at.clone(),
        thread_id: event.thread_id.clone(),
        process_id: None,
        broadcast_only: false,
    }
}

#[allow(clippy::too_many_arguments)]
fn persist_file_interaction(
    store: &dyn RecordStore,
    source: &str,
    source_session_id: Option<&str>,
    session_id: &str,
    source_event_id: Option<&str>,
    turn_id: Option<&str>,
    actor_id: Option<&str>,
    cwd: &str,
    file_path: &str,
    action: ResourceAction,
    outcome: ResourceInteractionOutcome,
    occurred_at: &str,
    capture_method: ResourceInteractionCaptureMethod,
    attribution_precision: AttributionPrecision,
) -> Result<(), String> {
    let resolved = resolve_file_resource(cwd, file_path);
    let repository_locator = resolved
        .repository_id
        .as_deref()
        .unwrap_or(&resolved.workspace_path);
    let resource_id = record_id(&[
        "resource",
        "file",
        repository_locator,
        &resolved.repo_relative_path,
    ]);
    store.upsert_file_resource(&FileResourceRecord {
        schema_version: RESOURCE_INTERACTION_SCHEMA_VERSION,
        resource_id: resource_id.clone(),
        repository_id: resolved.repository_id,
        workspace_path: resolved.workspace_path,
        repo_relative_path: resolved.repo_relative_path.clone(),
        display_path: resolved.display_path,
        path_hash: path_hash(&resolved.repo_relative_path),
    })?;

    let interaction_id = record_id(&[
        "interaction",
        source,
        session_id,
        source_event_id.unwrap_or(""),
        &resource_id,
        action.as_str(),
        occurred_at,
    ]);
    store.append_resource_interaction(&ResourceInteractionRecord {
        schema_version: RESOURCE_INTERACTION_SCHEMA_VERSION,
        interaction_id,
        source: source.to_string(),
        source_session_id: source_session_id.map(str::to_string),
        source_event_id: source_event_id.map(str::to_string),
        session_id: session_id.to_string(),
        turn_id: turn_id.map(str::to_string),
        actor_id: actor_id.map(str::to_string),
        resource_id,
        action,
        outcome,
        occurred_at: occurred_at.to_string(),
        capture_method,
        attribution_precision,
    })
}

pub fn resolve_file_resource(cwd: &str, file_path: &str) -> ResolvedFileResource {
    // Resolve aliases such as macOS `/tmp` -> `/private/tmp` on both sides
    // before comparing them. For create/delete events the leaf may not exist,
    // so canonicalize the longest existing prefix and reattach the tail.
    let cwd_path = canonicalize_existing_prefix(&absolute_lexical_path(Path::new(cwd), None));
    let file_path = canonicalize_existing_prefix(&absolute_lexical_path(
        Path::new(file_path),
        Some(&cwd_path),
    ));
    let workspace = git_output(&cwd_path, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .map(|path| canonicalize_existing_prefix(&absolute_lexical_path(&path, None)))
        .unwrap_or_else(|| cwd_path.clone());
    let within_workspace = file_path.strip_prefix(&workspace).ok();
    let repository_id = within_workspace.and_then(|_| {
        git_output(
            &workspace,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .filter(|common_dir| !common_dir.is_empty())
        .map(|common_dir| record_id(&["git_repository", &common_dir]))
    });
    let relative = within_workspace
        .unwrap_or(&file_path)
        .to_string_lossy()
        .trim_start_matches(['/', '\\'])
        .replace('\\', "/");
    ResolvedFileResource {
        repository_id,
        workspace_path: workspace.to_string_lossy().into_owned(),
        display_path: relative.clone(),
        repo_relative_path: relative,
    }
}

/// Periodically drains external hook envelopes while the desktop app is open.
/// A bounded drain keeps each blocking task predictable; remaining envelopes
/// are retried on the next tick and on file-history queries.
pub fn spawn_hook_inbox_drain_loop() {
    tauri::async_runtime::spawn(async {
        loop {
            let result = tauri::async_runtime::spawn_blocking(drain_hook_inbox).await;
            match result {
                Ok(Ok(_)) => {}
                Ok(Err(err)) => {
                    tracing::warn!(error = %err, "[SessionProvenance] Hook inbox drain failed");
                }
                Err(err) => {
                    tracing::warn!(error = %err, "[SessionProvenance] Hook inbox drain task failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
}

fn git_output(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn absolute_lexical_path(path: &Path, base: Option<&Path>) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn canonicalize_existing_prefix(path: &Path) -> PathBuf {
    let lexical = absolute_lexical_path(path, None);
    let mut cursor = lexical.clone();
    let mut missing_tail = Vec::new();
    loop {
        match fs::canonicalize(&cursor) {
            Ok(mut canonical) => {
                for component in missing_tail.iter().rev() {
                    canonical.push(component);
                }
                return absolute_lexical_path(&canonical, None);
            }
            Err(_) => {
                let Some(component) = cursor.file_name().map(|name| name.to_os_string()) else {
                    return lexical;
                };
                missing_tail.push(component);
                if !cursor.pop() {
                    return lexical;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_paths_without_leaking_content() {
        let temp = tempfile::tempdir().expect("temp workspace");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(workspace.join("src")).expect("workspace tree");
        let resolved =
            resolve_file_resource(workspace.to_string_lossy().as_ref(), "src/../src/lib.rs");
        assert_eq!(
            PathBuf::from(&resolved.workspace_path),
            fs::canonicalize(&workspace).expect("canonical workspace")
        );
        assert_eq!(resolved.repo_relative_path, "src/lib.rs");
        assert_eq!(resolved.display_path, "src/lib.rs");
    }

    #[cfg(unix)]
    #[test]
    fn resolves_symlink_aliases_for_not_yet_created_files() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("temp workspace");
        let real_workspace = temp.path().join("real-workspace");
        let alias_workspace = temp.path().join("alias-workspace");
        fs::create_dir_all(real_workspace.join("src")).expect("workspace tree");
        symlink(&real_workspace, &alias_workspace).expect("workspace alias");

        let aliased_file = alias_workspace.join("src/new.rs");
        let resolved = resolve_file_resource(
            alias_workspace.to_string_lossy().as_ref(),
            aliased_file.to_string_lossy().as_ref(),
        );

        assert_eq!(
            PathBuf::from(&resolved.workspace_path),
            fs::canonicalize(&real_workspace).expect("canonical workspace")
        );
        assert_eq!(resolved.repo_relative_path, "src/new.rs");
        assert_eq!(resolved.display_path, "src/new.rs");
    }
}
