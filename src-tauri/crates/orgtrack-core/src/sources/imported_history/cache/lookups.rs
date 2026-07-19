use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

pub fn get_cached_source_path_from_conn(
    conn: &Connection,
    source: &str,
    source_session_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT source_path FROM imported_history_session_cache \
         WHERE source = ?1 AND source_session_id = ?2",
        params![source, source_session_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|err| format!("Failed to query imported history source path: {err}"))
}

/// Like [`get_cached_source_path_from_conn`], but also matches a
/// `-`-bounded suffix of the cached key. Codex imports key on the rollout
/// file stem (`rollout-<timestamp>-<thread-uuid>`) while runner bindings
/// carry the bare thread uuid; newest wins when several rollouts share a
/// thread (resume forks).
pub fn get_cached_source_path_by_suffix_from_conn(
    conn: &Connection,
    source: &str,
    source_session_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT source_path FROM imported_history_session_cache \
         WHERE source = ?1 \
           AND (source_session_id = ?2 OR source_session_id LIKE '%-' || ?2) \
         ORDER BY updated_at_ms DESC LIMIT 1",
        params![source, source_session_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|err| format!("Failed to query imported history source path: {err}"))
}

/// Freshness stat of one imported session's transcript source file, keyed by
/// the app-level (prefixed) session id the frontend holds. Returns `Ok(None)`
/// when the session is not cached or the file is gone — callers fall back to
/// a full refresh, which re-syncs the cache.
///
/// SQLite-backed stores (Cursor, OpenCode, ZCode, …) run in WAL mode, where
/// commits land in the `-wal` sibling without touching the main db's mtime
/// until a checkpoint. Fold the sibling into the signature so those sources
/// don't read as permanently unchanged.
pub fn stat_imported_transcript_by_session_id_from_conn(
    conn: &Connection,
    source: &str,
    session_id: &str,
) -> Result<Option<(i64, u64)>, String> {
    let path: Option<String> = conn
        .query_row(
            "SELECT source_path FROM imported_history_session_cache \
             WHERE source = ?1 AND session_id = ?2 AND source_path != ''",
            params![source, session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to query imported history source path: {err}"))?;
    let Some(path) = path else {
        return Ok(None);
    };

    let Ok(main) = std::fs::metadata(&path) else {
        return Ok(None);
    };
    let mut mtime_ms = metadata_mtime_epoch_ms(&main);
    let mut size_bytes = main.len();
    if let Ok(wal) = std::fs::metadata(format!("{path}-wal")) {
        mtime_ms = mtime_ms.max(metadata_mtime_epoch_ms(&wal));
        size_bytes += wal.len();
    }
    Ok(Some((mtime_ms, size_bytes)))
}

fn metadata_mtime_epoch_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub fn current_epoch_ms() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("System time is before Unix epoch: {err}"))
        .map(|duration| duration.as_millis() as i64)
}
