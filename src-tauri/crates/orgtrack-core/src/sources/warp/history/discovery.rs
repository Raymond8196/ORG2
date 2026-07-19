//! Warp database access, schema probing, and on-disk path discovery.

use super::*;

pub(super) fn load_task_blobs(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Vec<Vec<u8>>, String> {
    if !table_exists(conn, "agent_tasks")? {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare("SELECT task FROM agent_tasks WHERE conversation_id = ?1 ORDER BY id ASC")
        .map_err(|err| format!("Failed to prepare Warp task query: {err}"))?;
    let rows = stmt
        .query_map([conversation_id], |row| row.get::<_, Vec<u8>>(0))
        .map_err(|err| format!("Failed to query Warp tasks: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read Warp task row: {err}"))
}

pub(super) fn load_conversation_last_modified_ms(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Option<i64>, String> {
    if !table_exists(conn, "agent_conversations")? {
        return Ok(None);
    }
    let raw = conn
        .query_row(
            "SELECT CAST(last_modified_at AS TEXT) FROM agent_conversations WHERE conversation_id = ?1",
            [conversation_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(raw.as_deref().and_then(parse_warp_timestamp_ms))
}

pub(super) fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|err| format!("Failed to inspect Warp table {table}: {err}"))
}

pub(super) fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|err| format!("Failed to inspect Warp table {table}: {err}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to inspect Warp table {table}: {err}"))?;
    for row in rows {
        if row.map_err(|err| format!("Failed to inspect Warp column: {err}"))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn warp_conversation_id_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(conversation_id) = session_id.strip_prefix(WARP_SESSION_PREFIX) else {
        return Err(format!("Invalid Warp session id: {session_id}"));
    };
    if conversation_id.trim().is_empty() {
        return Err("Warp session id is missing source id".to_string());
    }
    Ok(conversation_id)
}

pub(super) fn open_warp_db() -> Result<Option<(Connection, PathBuf)>, String> {
    for path in warp_history_candidate_paths() {
        if !path.is_file() {
            continue;
        }
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|err| format!("Failed to open Warp database {}: {err}", path.display()))?;
        return Ok(Some((conn, path)));
    }
    Ok(None)
}

pub(super) fn warp_db_candidate_paths_for_home(home: &Path) -> Vec<PathBuf> {
    dedupe_paths(vec![
        home.join("Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable").join(WARP_DB_FILENAME),
        home.join("Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Preview").join(WARP_DB_FILENAME),
        home.join("Library/Application Support/dev.warp.Warp-Stable").join(WARP_DB_FILENAME),
        home.join("Library/Application Support/dev.warp.Warp-Preview").join(WARP_DB_FILENAME),
        home.join(".local/state/warp-terminal").join(WARP_DB_FILENAME),
        home.join("AppData/Local/warp/Warp/data").join(WARP_DB_FILENAME),
    ])
}

pub(super) fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}
