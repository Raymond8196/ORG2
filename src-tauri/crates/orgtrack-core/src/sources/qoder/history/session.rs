use std::path::PathBuf;

use core_types::activity::ActivityChunk;
use rusqlite::Connection;

use super::*;

use crate::sources::imported_history::cache as imported_cache;
use crate::sources::imported_history::metadata::SOURCE_QODER;

pub fn list_qoder_history_sessions_paginated(
    conn: &mut Connection,
    limit: usize,
    offset: usize,
) -> Result<QoderHistorySessionPage, String> {
    sync_qoder_history_cache(conn)?;
    imported_cache::query_imported_session_page_from_conn(conn, SOURCE_QODER, limit, offset)
}

pub fn list_qoder_recent_paths(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<QoderRecentPath>, String> {
    sync_qoder_history_cache(conn)?;
    imported_cache::query_imported_recent_paths_from_conn(conn, SOURCE_QODER, limit)
}

pub fn load_qoder_history_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let source_session_id = qoder_source_id_from_session_id(session_id)?;
    let path = resolve_qoder_transcript_path(conn, source_session_id)?;
    let transcript = read_qoder_transcript(&path)?;
    let chunks = transcript_to_chunks(session_id, &transcript);
    // Best-effort: recover the tool trajectory from Qoder's per-launch logs
    // (see the log_enrichment module docs for what survives there). The
    // cached workspace path sharpens invoke attribution when available.
    let (project_dir_name, task_dir_name) = source_session_id
        .split_once('/')
        .unwrap_or(("", source_session_id));
    let workspace_path = imported_cache::query_cached_session_from_conn(
        conn,
        SOURCE_QODER,
        source_session_id,
    )
    .ok()
    .flatten()
    .and_then(|cached| cached.repo_path);
    Ok(super::super::log_enrichment::enrich_with_agent_log(
        session_id,
        task_dir_name,
        project_dir_name,
        workspace_path.as_deref(),
        chunks,
    ))
}

pub(super) fn qoder_source_id_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(rest) = session_id.strip_prefix(QODER_SESSION_PREFIX) else {
        return Err(format!("Invalid Qoder history session id: {session_id}"));
    };
    if rest.is_empty() {
        return Err("Qoder history session id is missing its source id".to_string());
    }
    Ok(rest)
}

fn resolve_qoder_transcript_path(
    conn: &Connection,
    source_session_id: &str,
) -> Result<PathBuf, String> {
    if let Some(path) =
        imported_cache::get_cached_source_path_from_conn(conn, SOURCE_QODER, source_session_id)?
    {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    // Directory names cannot contain '/', so the composite splits cleanly.
    if let Some((project_dir_name, task_dir_name)) = source_session_id.split_once('/') {
        for projects_dir in qoder_projects_dirs()? {
            let candidate = projects_dir
                .join(project_dir_name)
                .join(CONVERSATION_HISTORY_DIR)
                .join(task_dir_name)
                .join(format!("{task_dir_name}.jsonl"));
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(format!(
        "Qoder history file not found for session: {source_session_id}"
    ))
}
