//! Session-to-resource provenance ingestion.
//!
//! External hooks are intentionally split into two processes:
//! 1. the lightweight hook invocation normalizes vendor JSON and atomically
//!    writes privacy-filtered envelopes to an inbox;
//! 2. the desktop process drains that inbox and performs canonical DB writes.
//!
//! This keeps hooks fast, avoids SQLite contention, and ensures raw prompts,
//! tool responses, commands, and file contents never enter the spool.

mod historical_backfill;

pub(super) use historical_backfill::request_historical_backfill;

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use chrono::Utc;
use core_types::activity::ActivityChunk;
use core_types::extracted::ExtractedData;
use core_types::session_event::{EventDisplayStatus, SessionEvent};
use database::db::{begin_immediate, get_connection, with_sessions_writer};
use orgtrack_core::canonical::{
    AgentMetadata, AttributionPrecision, CollaborationSessionOrigin, FileResourceRecord,
    ResourceAction, ResourceInteractionCaptureMethod, ResourceInteractionEnvelopeV1,
    ResourceInteractionOutcome, ResourceInteractionRecord, SessionActorLifecycleEnvelopeV1,
    SessionActorLifecyclePhase, SessionActorRecord, SessionRecord,
    RESOURCE_INTERACTION_SCHEMA_VERSION, SESSION_ACTOR_SCHEMA_VERSION,
    SESSION_PROVENANCE_HOOK_ORIGIN, SOURCE_ORGII_CLOUD_REPLAY,
};
use orgtrack_core::hook_adapter::{
    normalize_actor_lifecycle_payload, normalize_hook_payload, HookSource,
};
use orgtrack_core::privacy::ORGTRACK_SCHEMA_VERSION;
use orgtrack_core::repo_sync::paths::{path_hash, record_id};
use orgtrack_core::resource_interaction::{
    activity_chunk_source_event_id, file_interactions_from_activity_chunk,
    interaction_outcome_from_activity_chunk,
};
use orgtrack_core::sources::codex::app::{
    load_codex_app_from_path, resolve_codex_transcript_for_thread_id_near_path,
};
use orgtrack_core::sources::imported_history::metadata::SOURCE_CODEX_APP;
use orgtrack_core::store::{sqlite::SqliteRecordStore, RecentHookSignal, RecordStore};
use session_persistence::CachedEvent;
use sha2::{Digest, Sha256};

/// Default and hard cap for the Session Provenance "recent signals" table.
const DEFAULT_RECENT_HOOK_SIGNALS: usize = 50;
const MAX_RECENT_HOOK_SIGNALS: usize = 500;

const MAX_HOOK_PAYLOAD_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DRAIN_BATCH: usize = 1_000;
const COLLABORATION_REPLAY_PARSER_VERSION: i64 = 1;
static INBOX_DRAIN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn collaboration_replay_fingerprint(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResolvedFileResource {
    pub(super) repository_id: Option<String>,
    pub(super) workspace_path: String,
    pub(super) repo_relative_path: String,
    pub(super) display_path: String,
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
    let lifecycle = normalize_actor_lifecycle_payload(source, &payload)?;
    let envelopes = normalize_hook_payload(source, &payload)?;
    for envelope in &envelopes {
        spool_envelope(envelope)?;
    }
    if let Some(lifecycle) = lifecycle.as_ref() {
        spool_actor_lifecycle(lifecycle)?;
    }
    Ok(envelopes.len() + usize::from(lifecycle.is_some()))
}

/// Return the most recently received session-provenance hook signals (file
/// interactions captured via managed hooks), newest first. Drains any pending
/// inbox envelopes first so a just-fired hook shows up without waiting for the
/// 15s background tick. Metadata only — never file contents or tool output.
#[tauri::command]
pub async fn session_provenance_recent_signals(
    limit: Option<usize>,
) -> Result<Vec<RecentHookSignal>, String> {
    tokio::task::spawn_blocking(move || {
        // Best-effort: surfacing stale rows is preferable to failing the query
        // if a single malformed envelope is stuck in the inbox.
        let _ = drain_hook_inbox();
        let limit = limit
            .unwrap_or(DEFAULT_RECENT_HOOK_SIGNALS)
            .clamp(1, MAX_RECENT_HOOK_SIGNALS);
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        store.list_recent_hook_signals(limit)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
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

fn spool_actor_lifecycle(envelope: &SessionActorLifecycleEnvelopeV1) -> Result<(), String> {
    envelope
        .validate()
        .map_err(|err| format!("Invalid session-actor lifecycle envelope: {err}"))?;
    let inbox = app_paths::session_provenance_inbox_dir();
    fs::create_dir_all(&inbox)
        .map_err(|err| format!("Failed to create {}: {err}", inbox.display()))?;
    let identity = record_id(&[
        "actor-lifecycle",
        &envelope.source,
        &envelope.session_id,
        envelope.turn_id.as_deref().unwrap_or(""),
        &envelope.actor_id,
        envelope.phase.as_str(),
        &envelope.occurred_at,
    ]);
    let path = inbox.join(format!("actor-{identity}.json"));
    if path.exists() {
        return Ok(());
    }
    let bytes = serde_json::to_vec(envelope)
        .map_err(|err| format!("Failed to serialize session-actor lifecycle: {err}"))?;
    let temp_path = inbox.join(format!(".actor-{identity}.{}.tmp", std::process::id()));
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
/// Malformed/version-incompatible files are moved to a rejected sibling
/// directory for upgrade diagnostics. Database failures leave the current and
/// remaining files in place for the next drain.
pub(super) fn drain_hook_inbox() -> Result<usize, String> {
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
        let bytes = fs::read(&path).map_err(|err| err.to_string())?;
        let persisted =
            if let Ok(envelope) = serde_json::from_slice::<ResourceInteractionEnvelopeV1>(&bytes) {
                if envelope.validate().is_err() {
                    false
                } else {
                    persist_envelope(&store, &envelope)?;
                    true
                }
            } else if let Ok(envelope) =
                serde_json::from_slice::<SessionActorLifecycleEnvelopeV1>(&bytes)
            {
                if envelope.validate().is_err() {
                    false
                } else {
                    persist_actor_lifecycle(&store, &envelope)?;
                    true
                }
            } else {
                false
            };
        if !persisted {
            quarantine_invalid_envelope(&inbox, &path)?;
            continue;
        }
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

fn quarantine_invalid_envelope(inbox: &Path, path: &Path) -> Result<(), String> {
    let rejected = inbox.parent().unwrap_or(inbox).join("rejected");
    fs::create_dir_all(&rejected)
        .map_err(|err| format!("Failed to create {}: {err}", rejected.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Invalid inbox envelope path: {}", path.display()))?;
    let target = rejected.join(file_name);
    if target.exists() {
        // Spool names are content/event identities. Retain the first rejected
        // copy and discard only an exact-name repeat so the inbox can advance.
        return fs::remove_file(path)
            .map_err(|err| format!("Failed to remove {}: {err}", path.display()));
    }
    fs::rename(path, &target).map_err(|err| {
        format!(
            "Failed to quarantine {} as {}: {err}",
            path.display(),
            target.display()
        )
    })
}

fn persist_actor_lifecycle(
    store: &SqliteRecordStore<'_>,
    envelope: &SessionActorLifecycleEnvelopeV1,
) -> Result<(), String> {
    let existing = store.get_session_actor_by_source_identity(
        &envelope.source,
        &envelope.source_session_id,
        &envelope.actor_id,
    )?;
    let root_transcript = resolve_lifecycle_root_transcript(envelope)?;
    let root_session_id = root_transcript
        .as_ref()
        .map(|locator| locator.session_id.clone())
        .or_else(|| {
            existing
                .as_ref()
                .map(|record| record.session_id.clone())
                .filter(|session_id| codex_rollout_source_session_id(session_id).is_some())
        })
        .or_else(|| {
            codex_rollout_source_session_id(&envelope.session_id)
                .map(|_| envelope.session_id.clone())
        })
        .or_else(|| existing.as_ref().map(|record| record.session_id.clone()))
        .unwrap_or_else(|| envelope.session_id.clone());
    let root_source_session_id = root_transcript
        .as_ref()
        .map(|locator| locator.source_session_id.clone())
        .or_else(|| codex_rollout_source_session_id(&root_session_id).map(ToString::to_string))
        .unwrap_or_else(|| envelope.source_session_id.clone());

    let mut root_session = match store.get_session(&root_session_id)? {
        Some(mut session) => {
            session.created_at =
                merge_earliest_timestamp(session.created_at, Some(envelope.occurred_at.as_str()));
            session.updated_at =
                merge_latest_timestamp(session.updated_at, Some(envelope.occurred_at.as_str()));
            session
        }
        None => SessionRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            source: envelope.source.clone(),
            source_session_id: root_source_session_id.clone(),
            session_id: root_session_id.clone(),
            title: root_source_session_id,
            status: None,
            created_at: Some(envelope.occurred_at.clone()),
            updated_at: Some(envelope.occurred_at.clone()),
            completed_at: None,
            workspace_path: Some(envelope.cwd.clone()),
            branch: None,
            parent_session_id: None,
            org_member_id: None,
            collaboration_origin: None,
            metadata: AgentMetadata {
                origin: Some(SESSION_PROVENANCE_HOOK_ORIGIN.to_string()),
                ..AgentMetadata::default()
            },
        },
    };
    if root_transcript.is_some() {
        // The resolver found a concrete rollout file. Promote a prior hook
        // placeholder to a replayable session without waiting for backfill.
        root_session.metadata.origin = Some(envelope.source.clone());
    }
    store.upsert_session(&root_session)?;

    let transcript = actor_transcript_target(envelope)
        .or_else(|| existing.as_ref().and_then(stored_actor_transcript_target));
    if let Some((source_session_id, transcript_session_id, _)) = transcript.as_ref() {
        let child = match store.get_session(transcript_session_id)? {
            Some(mut child) => {
                child.parent_session_id = Some(root_session_id.clone());
                child.created_at =
                    merge_earliest_timestamp(child.created_at, Some(envelope.occurred_at.as_str()));
                child.updated_at =
                    merge_latest_timestamp(child.updated_at, Some(envelope.occurred_at.as_str()));
                if envelope.phase == SessionActorLifecyclePhase::Stopped {
                    child.completed_at = merge_latest_timestamp(
                        child.completed_at,
                        Some(envelope.occurred_at.as_str()),
                    );
                }
                child.metadata.origin = Some(envelope.source.clone());
                child
            }
            None => SessionRecord {
                schema_version: ORGTRACK_SCHEMA_VERSION,
                source: envelope.source.clone(),
                source_session_id: source_session_id.clone(),
                session_id: transcript_session_id.clone(),
                title: envelope
                    .actor_type
                    .clone()
                    .unwrap_or_else(|| envelope.actor_id.clone()),
                status: None,
                created_at: Some(envelope.occurred_at.clone()),
                updated_at: Some(envelope.occurred_at.clone()),
                completed_at: (envelope.phase == SessionActorLifecyclePhase::Stopped)
                    .then(|| envelope.occurred_at.clone()),
                workspace_path: Some(envelope.cwd.clone()),
                branch: None,
                parent_session_id: Some(root_session_id.clone()),
                org_member_id: None,
                collaboration_origin: None,
                metadata: AgentMetadata {
                    origin: Some(envelope.source.clone()),
                    display_name: envelope.actor_type.clone(),
                    ..AgentMetadata::default()
                },
            },
        };
        store.upsert_session(&child)?;
    }

    let (transcript_source_session_id, transcript_session_id, transcript_path) = transcript
        .map(|(source_session_id, session_id, path)| {
            (Some(source_session_id), Some(session_id), Some(path))
        })
        .unwrap_or((None, None, None));
    let started_at = merge_earliest_timestamp(
        existing
            .as_ref()
            .and_then(|record| record.started_at.clone()),
        (envelope.phase == SessionActorLifecyclePhase::Started)
            .then_some(envelope.occurred_at.as_str()),
    );
    let stopped_at = merge_latest_timestamp(
        existing
            .as_ref()
            .and_then(|record| record.stopped_at.clone()),
        (envelope.phase == SessionActorLifecyclePhase::Stopped)
            .then_some(envelope.occurred_at.as_str()),
    );
    let actor_record = SessionActorRecord {
        schema_version: SESSION_ACTOR_SCHEMA_VERSION,
        actor_record_id: record_id(&[
            "session-actor",
            &envelope.source,
            &envelope.source_session_id,
            &envelope.actor_id,
        ]),
        source: envelope.source.clone(),
        source_session_id: envelope.source_session_id.clone(),
        session_id: root_session_id,
        turn_id: envelope
            .turn_id
            .clone()
            .or_else(|| existing.as_ref().and_then(|record| record.turn_id.clone())),
        actor_id: envelope.actor_id.clone(),
        actor_type: envelope.actor_type.clone().or_else(|| {
            existing
                .as_ref()
                .and_then(|record| record.actor_type.clone())
        }),
        started_at,
        stopped_at,
        transcript_session_id: transcript_session_id.or_else(|| {
            existing
                .as_ref()
                .and_then(|record| record.transcript_session_id.clone())
        }),
        transcript_path: transcript_path.or_else(|| {
            existing
                .as_ref()
                .and_then(|record| record.transcript_path.clone())
        }),
    };
    store.upsert_session_actor(&actor_record)?;

    if envelope.phase == SessionActorLifecyclePhase::Stopped {
        if let (Some(source_session_id), Some(transcript_session_id), Some(transcript_path)) = (
            transcript_source_session_id.as_deref(),
            actor_record.transcript_session_id.as_deref(),
            actor_record.transcript_path.as_deref(),
        ) {
            let path = Path::new(transcript_path);
            if path.is_file() {
                match load_codex_app_from_path(transcript_session_id, path) {
                    Ok(chunks) => {
                        store.delete_reconciled_resource_interactions(
                            &envelope.source,
                            transcript_session_id,
                        )?;
                        persist_activity_chunks(
                            store,
                            &envelope.source,
                            Some(source_session_id),
                            transcript_session_id,
                            Some(&envelope.actor_id),
                            &envelope.cwd,
                            AttributionPrecision::Exact,
                            &chunks,
                        )?;
                    }
                    Err(err) => tracing::warn!(
                        actor_id = %envelope.actor_id,
                        transcript_path,
                        error = %err,
                        "[SessionProvenance] Codex subagent transcript reconciliation failed"
                    ),
                }
            }
        }
    }
    Ok(())
}

fn merge_earliest_timestamp(current: Option<String>, incoming: Option<&str>) -> Option<String> {
    match (current, incoming) {
        (Some(current), Some(incoming)) if incoming < current.as_str() => {
            Some(incoming.to_string())
        }
        (Some(current), _) => Some(current),
        (None, Some(incoming)) => Some(incoming.to_string()),
        (None, None) => None,
    }
}

fn merge_latest_timestamp(current: Option<String>, incoming: Option<&str>) -> Option<String> {
    match (current, incoming) {
        (Some(current), Some(incoming)) if incoming > current.as_str() => {
            Some(incoming.to_string())
        }
        (Some(current), _) => Some(current),
        (None, Some(incoming)) => Some(incoming.to_string()),
        (None, None) => None,
    }
}

fn codex_rollout_source_session_id(session_id: &str) -> Option<&str> {
    if !session_id.starts_with(orgtrack_core::sources::codex::SESSION_PREFIX) {
        return None;
    }
    session_id
        .strip_prefix(orgtrack_core::sources::codex::SESSION_PREFIX)
        .filter(|source_session_id| source_session_id.starts_with("rollout-"))
}

fn resolve_lifecycle_root_transcript(
    envelope: &SessionActorLifecycleEnvelopeV1,
) -> Result<Option<orgtrack_core::sources::codex::app::CodexTranscriptLocator>, String> {
    if envelope.source != SOURCE_CODEX_APP {
        return Ok(None);
    }
    let Some(reference_path) = envelope
        .transcript_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return Ok(None);
    };
    resolve_codex_transcript_for_thread_id_near_path(
        Path::new(reference_path),
        &envelope.source_session_id,
    )
}

fn actor_transcript_target(
    envelope: &SessionActorLifecycleEnvelopeV1,
) -> Option<(String, String, String)> {
    if envelope.source != SOURCE_CODEX_APP {
        return None;
    }
    let path = envelope.transcript_path.as_deref()?.trim();
    if !Path::new(path).is_file() {
        return None;
    }
    let source_session_id = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())?
        .trim();
    if source_session_id.is_empty() {
        return None;
    }
    Some((
        source_session_id.to_string(),
        orgtrack_core::sources::codex::canonical_session_id(source_session_id),
        path.to_string(),
    ))
}

fn stored_actor_transcript_target(record: &SessionActorRecord) -> Option<(String, String, String)> {
    if record.source != SOURCE_CODEX_APP {
        return None;
    }
    let path = record.transcript_path.as_deref()?.trim();
    if !Path::new(path).is_file() {
        return None;
    }
    let source_session_id = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())?
        .trim();
    let transcript_session_id = record.transcript_session_id.as_deref()?.trim();
    if source_session_id.is_empty() || transcript_session_id.is_empty() {
        return None;
    }
    Some((
        source_session_id.to_string(),
        transcript_session_id.to_string(),
        path.to_string(),
    ))
}

fn persist_envelope(
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
            collaboration_origin: None,
            metadata: AgentMetadata {
                origin: Some(SESSION_PROVENANCE_HOOK_ORIGIN.to_string()),
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
pub(crate) fn persist_native_event_interactions(
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

/// Build the local Session Blame read model for an authorized Team Session
/// replay. The transcript is already present in the normal event cache; this
/// function only derives the privacy-filtered resource facts defined by the
/// Orgtrack protocol.
///
/// Absolute paths from the owner's machine are never persisted. They are
/// translated to the viewer's checkout when the owner workspace is known;
/// unprovable absolute paths are skipped rather than attributed to the wrong
/// repository.
#[allow(clippy::too_many_arguments)]
pub(crate) fn index_collaboration_replay(
    local_session_id: &str,
    source_session_id: &str,
    title: &str,
    workspace_path: &str,
    source_workspace_path: Option<&str>,
    org_id: &str,
    session_row_id: &str,
    owner_member_id: &str,
    owner_display_name: &str,
) -> Result<usize, String> {
    for (field, value) in [
        ("localSessionId", local_session_id),
        ("sourceSessionId", source_session_id),
        ("workspacePath", workspace_path),
        ("orgId", org_id),
        ("sessionRowId", session_row_id),
        ("ownerMemberId", owner_member_id),
        ("ownerDisplayName", owner_display_name),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{field} must not be empty"));
        }
    }

    let metadata = session_persistence::get_session_metadata(local_session_id)
        .map_err(|err| format!("Failed to load collaboration replay metadata: {err}"))?
        .ok_or_else(|| {
            "Collaboration replay is not present in the local event cache".to_string()
        })?;
    // Persist only a digest: the import checkpoint must change when either
    // checkout changes, but it must never retain the owner's absolute path.
    let event_count = metadata.event_count.to_string();
    let cached_at = metadata.cached_at.to_string();
    let fingerprint = collaboration_replay_fingerprint(&[
        &event_count,
        &cached_at,
        metadata.time_range_start.as_deref().unwrap_or_default(),
        metadata.time_range_end.as_deref().unwrap_or_default(),
        workspace_path,
        source_workspace_path.unwrap_or_default(),
        source_session_id,
        owner_member_id,
    ]);
    let session = SessionRecord {
        schema_version: ORGTRACK_SCHEMA_VERSION,
        source: SOURCE_ORGII_CLOUD_REPLAY.to_string(),
        source_session_id: source_session_id.to_string(),
        session_id: local_session_id.to_string(),
        title: title.to_string(),
        status: Some("completed".to_string()),
        created_at: metadata.time_range_start.clone(),
        updated_at: metadata.time_range_end.clone(),
        completed_at: metadata.time_range_end.clone(),
        workspace_path: Some(workspace_path.to_string()),
        branch: None,
        parent_session_id: None,
        org_member_id: Some(owner_member_id.to_string()),
        collaboration_origin: Some(CollaborationSessionOrigin {
            org_id: org_id.to_string(),
            session_row_id: session_row_id.to_string(),
            source_session_id: source_session_id.to_string(),
            owner_member_id: owner_member_id.to_string(),
            owner_display_name: owner_display_name.to_string(),
        }),
        metadata: AgentMetadata {
            origin: Some(SOURCE_ORGII_CLOUD_REPLAY.to_string()),
            display_name: Some(owner_display_name.to_string()),
            ..AgentMetadata::default()
        },
    };
    // Avoid loading a potentially large transcript when its derived index is
    // already current. The checkpoint is checked again under the process-wide
    // writer lock below, so a racing import can never double-reconcile.
    let preflight_current = {
        let conn = get_connection().map_err(|err| err.to_string())?;
        SqliteRecordStore::new(&conn).interaction_import_is_current(
            SOURCE_ORGII_CLOUD_REPLAY,
            local_session_id,
            &fingerprint,
            COLLABORATION_REPLAY_PARSER_VERSION,
        )?
    };
    let mut events = if preflight_current {
        None
    } else {
        Some(
            session_persistence::load_events(local_session_id)
                .map_err(|err| format!("Failed to load collaboration replay events: {err}"))?,
        )
    };

    with_sessions_writer(|| {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let tx = begin_immediate(&conn).map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&tx);
        store.upsert_session(&session)?;
        if store.interaction_import_is_current(
            SOURCE_ORGII_CLOUD_REPLAY,
            local_session_id,
            &fingerprint,
            COLLABORATION_REPLAY_PARSER_VERSION,
        )? {
            drop(store);
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(0);
        }

        let events = match events.take() {
            Some(events) => events,
            None => session_persistence::load_events(local_session_id)
                .map_err(|err| format!("Failed to load collaboration replay events: {err}"))?,
        };
        store
            .delete_reconciled_resource_interactions(SOURCE_ORGII_CLOUD_REPLAY, local_session_id)?;

        let mut persisted = 0;
        for event in &events {
            let chunk = cached_event_to_activity_chunk(event);
            let outcome = interaction_outcome_from_activity_chunk(&chunk);
            for mut interaction in file_interactions_from_activity_chunk(&chunk) {
                let Some(mapped_path) = remap_collaboration_file_path(
                    &interaction.file_path,
                    source_workspace_path,
                    workspace_path,
                ) else {
                    continue;
                };
                interaction.file_path = mapped_path;
                let source_event_id = activity_chunk_source_event_id(&chunk, &interaction);
                persist_file_interaction(
                    &store,
                    SOURCE_ORGII_CLOUD_REPLAY,
                    Some(source_session_id),
                    local_session_id,
                    Some(&source_event_id),
                    chunk.thread_id.as_deref(),
                    Some(owner_member_id),
                    workspace_path,
                    &interaction.file_path,
                    interaction.action,
                    outcome,
                    &chunk.created_at,
                    ResourceInteractionCaptureMethod::Reconciled,
                    AttributionPrecision::Exact,
                )?;
                persisted += 1;
            }
        }
        store.mark_interaction_imported(
            SOURCE_ORGII_CLOUD_REPLAY,
            local_session_id,
            &fingerprint,
            COLLABORATION_REPLAY_PARSER_VERSION,
            &Utc::now().to_rfc3339(),
        )?;
        drop(store);
        tx.commit().map_err(|err| err.to_string())?;
        Ok(persisted)
    })
}

pub(crate) fn delete_collaboration_replay(local_session_id: &str) -> Result<(), String> {
    if local_session_id.trim().is_empty() {
        return Err("localSessionId must not be empty".to_string());
    }
    with_sessions_writer(|| {
        let conn = get_connection().map_err(|err| err.to_string())?;
        SqliteRecordStore::new(&conn)
            .delete_collaboration_session_provenance(SOURCE_ORGII_CLOUD_REPLAY, local_session_id)
    })
}

fn remap_collaboration_file_path(
    file_path: &str,
    source_workspace_path: Option<&str>,
    workspace_path: &str,
) -> Option<String> {
    let file = Path::new(file_path);
    if !file.is_absolute() {
        let mut depth = 0_i32;
        for component in file.components() {
            match component {
                Component::Normal(_) => depth += 1,
                Component::ParentDir => {
                    depth -= 1;
                    if depth < 0 {
                        return None;
                    }
                }
                Component::CurDir => {}
                Component::RootDir | Component::Prefix(_) => return None,
            }
        }
        return (!file_path.trim().is_empty()).then(|| file_path.to_string());
    }

    let local_workspace = Path::new(workspace_path);
    if file.starts_with(local_workspace) {
        return Some(file.to_string_lossy().into_owned());
    }
    let source_workspace = Path::new(source_workspace_path?.trim());
    if !source_workspace.is_absolute() {
        return None;
    }
    let relative = file.strip_prefix(source_workspace).ok()?;
    Some(
        local_workspace
            .join(relative)
            .to_string_lossy()
            .into_owned(),
    )
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

    let interaction_id = resource_interaction_id(
        source,
        session_id,
        source_event_id,
        actor_id,
        &resource_id,
        action,
        occurred_at,
        capture_method,
    );
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

#[allow(clippy::too_many_arguments)]
fn resource_interaction_id(
    source: &str,
    session_id: &str,
    source_event_id: Option<&str>,
    actor_id: Option<&str>,
    resource_id: &str,
    action: ResourceAction,
    occurred_at: &str,
    capture_method: ResourceInteractionCaptureMethod,
) -> String {
    // A hook observation and a later reconciled observation are distinct
    // immutable facts even when they describe the same vendor tool event.
    // The read projection correlates and selects the strongest one.
    record_id(&[
        "interaction",
        source,
        session_id,
        source_event_id.unwrap_or(""),
        actor_id.unwrap_or(""),
        resource_id,
        action.as_str(),
        occurred_at,
        capture_method.as_str(),
    ])
}

pub(super) fn resolve_file_resource(cwd: &str, file_path: &str) -> ResolvedFileResource {
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
pub(crate) fn spawn_hook_inbox_drain_loop() {
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
    use orgtrack_core::sources::codex::app::load_codex_app_for_session;
    use orgtrack_core::sources::imported_history::metadata::SOURCE_CLAUDE_CODE;
    use rusqlite::Connection;

    #[test]
    fn interaction_identity_preserves_independent_capture_observations() {
        let hook_id = resource_interaction_id(
            SOURCE_CLAUDE_CODE,
            "root-session",
            Some("tool-1"),
            None,
            "file-1",
            ResourceAction::Read,
            "2026-07-14T01:00:00Z",
            ResourceInteractionCaptureMethod::Hook,
        );
        let reconciled_id = resource_interaction_id(
            SOURCE_CLAUDE_CODE,
            "child-session",
            Some("tool-1"),
            Some("agent-1"),
            "file-1",
            ResourceAction::Read,
            "2026-07-14T01:00:00Z",
            ResourceInteractionCaptureMethod::Reconciled,
        );

        assert_ne!(hook_id, reconciled_id);
        assert_eq!(
            hook_id,
            resource_interaction_id(
                SOURCE_CLAUDE_CODE,
                "root-session",
                Some("tool-1"),
                None,
                "file-1",
                ResourceAction::Read,
                "2026-07-14T01:00:00Z",
                ResourceInteractionCaptureMethod::Hook,
            )
        );
    }

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

    #[test]
    fn malformed_envelopes_are_quarantined_for_upgrade_diagnostics() {
        let temp = tempfile::tempdir().expect("temporary provenance root");
        let inbox = temp.path().join("inbox");
        fs::create_dir_all(&inbox).expect("inbox");
        let path = inbox.join("invalid.json");
        fs::write(&path, b"not-json").expect("invalid envelope");

        quarantine_invalid_envelope(&inbox, &path).expect("quarantine invalid envelope");

        assert!(!path.exists());
        assert!(temp.path().join("rejected").join("invalid.json").is_file());
    }

    #[test]
    fn codex_lifecycle_maps_actor_to_independently_loadable_transcript() {
        let conn = Connection::open_in_memory().expect("in-memory SQLite");
        SqliteRecordStore::init_tables(&conn).expect("initialize orgtrack schema");
        let store = SqliteRecordStore::new(&conn);
        let temp = tempfile::tempdir().expect("Codex session root");
        let sessions_dir = temp
            .path()
            .join("sessions")
            .join("2026")
            .join("07")
            .join("14");
        fs::create_dir_all(&sessions_dir).expect("Codex sessions tree");
        let parent_thread_id = "019f6177-f314-7433-a3ed-1c498aa42967";
        let child_thread_id = "019f6177-f314-7433-a3ed-1c498aa42968";
        let parent_stem = format!("rollout-2026-07-14T01-00-00-{parent_thread_id}");
        let child_stem = format!("rollout-2026-07-14T01-01-00-{child_thread_id}");
        let parent_path = sessions_dir.join(format!("{parent_stem}.jsonl"));
        let child_path = sessions_dir.join(format!("{child_stem}.jsonl"));
        fs::write(
            &parent_path,
            r#"{"timestamp":"2026-07-14T01:00:00Z","type":"event_msg","payload":{"type":"user_message","message":"parent transcript marker"}}
"#,
        )
        .expect("write parent transcript");
        fs::write(
            &child_path,
            r#"{"timestamp":"2026-07-14T01:01:00Z","type":"event_msg","payload":{"type":"user_message","message":"child transcript marker"}}
"#,
        )
        .expect("write child transcript");
        let transcript_path = child_path.to_string_lossy().into_owned();
        let parent_session_id = orgtrack_core::sources::codex::canonical_session_id(&parent_stem);
        let child_session_id = orgtrack_core::sources::codex::canonical_session_id(&child_stem);

        persist_actor_lifecycle(
            &store,
            &SessionActorLifecycleEnvelopeV1 {
                schema_version: SESSION_ACTOR_SCHEMA_VERSION,
                source: SOURCE_CODEX_APP.to_string(),
                source_session_id: parent_thread_id.to_string(),
                // Real Codex payloads can remain provisional at stop time;
                // the child path plus parent UUID must resolve the rollout.
                session_id: format!("codexapp-{parent_thread_id}"),
                turn_id: Some("turn-1".to_string()),
                actor_id: "agent-1".to_string(),
                actor_type: Some("explorer".to_string()),
                phase: SessionActorLifecyclePhase::Stopped,
                occurred_at: "2026-07-14T01:02:00Z".to_string(),
                cwd: "/repo".to_string(),
                transcript_path: Some(transcript_path.clone()),
            },
        )
        .expect("persist stop first");
        persist_actor_lifecycle(
            &store,
            &SessionActorLifecycleEnvelopeV1 {
                schema_version: SESSION_ACTOR_SCHEMA_VERSION,
                source: SOURCE_CODEX_APP.to_string(),
                source_session_id: parent_thread_id.to_string(),
                // Inbox delivery is not ordered: a late SubagentStart must
                // not downgrade the concrete parent found by SubagentStop.
                session_id: format!("codexapp-{parent_thread_id}"),
                turn_id: Some("turn-1".to_string()),
                actor_id: "agent-1".to_string(),
                actor_type: Some("explorer".to_string()),
                phase: SessionActorLifecyclePhase::Started,
                occurred_at: "2026-07-14T01:00:00Z".to_string(),
                cwd: "/repo".to_string(),
                transcript_path: None,
            },
        )
        .expect("persist late start");

        let actor = store
            .get_session_actor(SOURCE_CODEX_APP, &parent_session_id, "agent-1")
            .expect("query actor")
            .expect("actor mapping");
        assert_eq!(actor.started_at.as_deref(), Some("2026-07-14T01:00:00Z"));
        assert_eq!(actor.stopped_at.as_deref(), Some("2026-07-14T01:02:00Z"));
        assert_eq!(
            actor.transcript_session_id.as_deref(),
            Some(child_session_id.as_str())
        );
        assert_eq!(
            actor.transcript_path.as_deref(),
            Some(transcript_path.as_str())
        );

        let child = store
            .get_session(&child_session_id)
            .expect("query child")
            .expect("child session");
        assert_eq!(child.created_at.as_deref(), Some("2026-07-14T01:00:00Z"));
        assert_eq!(child.updated_at.as_deref(), Some("2026-07-14T01:02:00Z"));
        assert_eq!(child.completed_at.as_deref(), Some("2026-07-14T01:02:00Z"));
        assert_eq!(
            child.parent_session_id.as_deref(),
            Some(parent_session_id.as_str())
        );
        let parent = store
            .get_session(&parent_session_id)
            .expect("query parent")
            .expect("parent session");
        assert_eq!(parent.created_at.as_deref(), Some("2026-07-14T01:00:00Z"));
        assert_eq!(parent.updated_at.as_deref(), Some("2026-07-14T01:02:00Z"));
        assert_eq!(parent.metadata.origin.as_deref(), Some(SOURCE_CODEX_APP));
        assert_eq!(child.metadata.origin.as_deref(), Some(SOURCE_CODEX_APP));
        let parent_chunks = load_codex_app_for_session(&conn, &parent_session_id)
            .expect("load parent through lifecycle locator");
        assert!(parent_chunks.iter().any(|chunk| {
            chunk.args.to_string().contains("parent transcript marker")
                || chunk
                    .result
                    .to_string()
                    .contains("parent transcript marker")
        }));
        let child_chunks = load_codex_app_for_session(&conn, &child_session_id)
            .expect("load child through actor transcript locator");
        assert!(child_chunks.iter().any(|chunk| {
            chunk.args.to_string().contains("child transcript marker")
                || chunk.result.to_string().contains("child transcript marker")
        }));
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

    #[test]
    fn collaboration_paths_remap_only_when_repository_identity_is_provable() {
        assert_eq!(
            remap_collaboration_file_path(
                "/owner/ORG2/src/main.ts",
                Some("/owner/ORG2"),
                "/viewer/ORG2"
            )
            .as_deref(),
            Some("/viewer/ORG2/src/main.ts")
        );
        assert_eq!(
            remap_collaboration_file_path("src/main.ts", None, "/viewer/ORG2").as_deref(),
            Some("src/main.ts")
        );
        assert!(remap_collaboration_file_path(
            "/owner/other/secret.txt",
            Some("/owner/ORG2"),
            "/viewer/ORG2"
        )
        .is_none());
        assert!(remap_collaboration_file_path(
            "../outside.txt",
            Some("/owner/ORG2"),
            "/viewer/ORG2"
        )
        .is_none());
    }

    #[test]
    fn collaboration_checkpoint_is_private_and_unambiguous() {
        let owner_path = "/owner/private/ORG2";
        let fingerprint = collaboration_replay_fingerprint(&["12", owner_path, "session"]);

        assert_eq!(fingerprint.len(), 64);
        assert!(!fingerprint.contains(owner_path));
        assert_ne!(
            collaboration_replay_fingerprint(&["a:b", "c"]),
            collaboration_replay_fingerprint(&["a", "b:c"])
        );
    }
}
