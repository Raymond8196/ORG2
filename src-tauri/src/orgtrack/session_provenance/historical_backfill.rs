//! Incremental, repository-scoped historical Session Provenance backfill.
//!
//! Provider discovery and transcript decoding deliberately reuse the existing
//! imported-history caches and loaders. This module owns only scheduling,
//! checkpoints, prioritization, and projection into canonical interactions.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use database::db::get_connection;
use orgtrack_core::canonical::{
    AttributionPrecision, SessionRecord, SOURCE_ORGII_CLI_SESSIONS, SOURCE_ORGII_RUST_AGENTS,
};
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

use super::{
    cached_event_to_activity_chunk, canonicalize_existing_prefix, persist_activity_chunks,
};

const HISTORICAL_INTERACTION_PARSER_VERSION: i64 = 2;
const BACKFILL_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const BACKFILL_JOB_RETENTION: Duration = Duration::from_secs(60 * 60);
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

    fn snapshot(&self) -> crate::orgtrack::types::FileSessionHistoryBackfill {
        crate::orgtrack::types::FileSessionHistoryBackfill {
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

/// Start (or join) one repository-scoped historical transcript backfill.
///
/// The file-history read path only schedules this work. Source discovery and
/// transcript parsing run on a dedicated blocking thread, so opening a file is
/// never held hostage by the size of the user's history. Per-session source
/// fingerprints in SQLite are the durable queue: after a crash or restart the
/// next request skips current checkpoints and resumes only stale sessions.
pub(in crate::orgtrack) fn request_historical_backfill(
    repo_path: &str,
    priority_file: &str,
) -> crate::orgtrack::types::FileSessionHistoryBackfill {
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

    let mut imported_sessions = Vec::new();
    for source in [SOURCE_CLAUDE_CODE, SOURCE_CODEX_APP, SOURCE_CURSOR_IDE] {
        match imported_sessions_for_repo(conn, source, repo_path, &canonical_repo) {
            Ok(sessions) => {
                imported_sessions.extend(sessions.into_iter().map(|session| (source, session)))
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
    // Prioritize the requested file across every provider. Per-provider
    // batching can otherwise index hundreds of unrelated Claude sessions
    // before the one relevant Codex or Cursor transcript.
    imported_sessions.sort_by_key(|(_, session)| {
        !session_touches_priority_file(session, &canonical_repo, priority_file)
    });
    let native_sessions = native_sessions_for_repo(conn, repo_path, &canonical_repo)?;
    let total_sessions = imported_sessions.len() + native_sessions.len() + discovery_failures;
    let mut indexed_sessions = 0;
    let mut failed_sessions = discovery_failures;
    progress(indexed_sessions, total_sessions, failed_sessions);

    for (source, session) in imported_sessions {
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
