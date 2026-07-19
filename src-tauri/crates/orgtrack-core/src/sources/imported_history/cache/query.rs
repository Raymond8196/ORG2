use rusqlite::{
    params_from_iter, types::Type, types::Value as SqlValue, Connection, OptionalExtension,
};

use super::super::metadata::ImportedHistoryImpactStats;
use super::super::{
    effective_limit, recent_paths_from_rows, ImportedHistoryRecentPath, ImportedHistorySessionPage,
    ImportedHistorySidebarPage, ImportedHistorySidebarRow,
};
use super::ImportedHistoryCachedSession;

pub fn query_imported_session_page_from_conn(
    conn: &Connection,
    source: &str,
    limit: usize,
    offset: usize,
) -> Result<ImportedHistorySessionPage, String> {
    let limit = effective_limit(limit);
    let rows = query_cached_sessions_from_conn(conn, source, limit.saturating_add(1), offset)?;
    let has_more = rows.len() > limit;
    let sessions = rows
        .into_iter()
        .take(limit)
        .map(|session| session.to_row())
        .collect();
    Ok(ImportedHistorySessionPage { sessions, has_more })
}

/// Query a bounded, lightweight page from ORGII's imported-history cache.
/// `end_ms` is exclusive so adjacent date buckets cannot overlap.
pub fn query_imported_sidebar_page_from_conn(
    conn: &Connection,
    source: &str,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    limit: usize,
    offset: usize,
) -> Result<ImportedHistorySidebarPage, String> {
    let limit = effective_limit(limit);
    let mut range_sql = String::new();
    let mut values = vec![SqlValue::from(source.to_string())];
    if let Some(start_ms) = start_ms {
        values.push(SqlValue::from(start_ms));
        range_sql.push_str(&format!(" AND updated_at_ms >= ?{}", values.len()));
    }
    if let Some(end_ms) = end_ms {
        values.push(SqlValue::from(end_ms));
        range_sql.push_str(&format!(" AND updated_at_ms < ?{}", values.len()));
    }
    let limit_param = values.len() + 1;
    let offset_param = values.len() + 2;
    values.push(SqlValue::from(limit.saturating_add(1) as i64));
    values.push(SqlValue::from(offset as i64));
    let sql = format!(
        "SELECT session_id, name, created_at_ms, updated_at_ms, repo_path,
                model, files_changed, lines_added, lines_removed, touched_files_json,
                input_tokens, output_tokens, source_path
         FROM imported_history_session_cache
         WHERE source = ?1
           AND listable = 1
           AND parent_session_id = ''
           {range_sql}
         ORDER BY updated_at_ms DESC, created_at_ms DESC, source_session_id ASC
         LIMIT ?{limit_param} OFFSET ?{offset_param}"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare imported sidebar query for {source}: {err}"))?;
    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            let repo_path: String = row.get(4)?;
            let model: String = row.get(5)?;
            let touched_files_json: String = row.get(9)?;
            let touched_files =
                serde_json::from_str::<Vec<String>>(&touched_files_json).map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(9, Type::Text, Box::new(err))
                })?;
            let input_tokens: i64 = row.get(10)?;
            let output_tokens: i64 = row.get(11)?;
            let source_path: String = row.get(12)?;
            Ok(ImportedHistorySidebarRow {
                session_id: row.get(0)?,
                name: row.get(1)?,
                created_at: super::super::epoch_ms_to_iso(row.get(2)?),
                updated_at: super::super::epoch_ms_to_iso(row.get(3)?),
                status: None,
                is_active: None,
                repo_path: non_empty_string(repo_path),
                storage_path: non_empty_string(source_path),
                model: non_empty_string(model),
                total_tokens: input_tokens + output_tokens,
                files_changed: row.get(6)?,
                lines_added: row.get(7)?,
                lines_removed: row.get(8)?,
                touched_files,
            })
        })
        .map_err(|err| format!("Failed to query imported sidebar rows for {source}: {err}"))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(
            row.map_err(|err| format!("Failed to read imported sidebar row for {source}: {err}"))?,
        );
    }
    let has_more = sessions.len() > limit;
    sessions.truncate(limit);
    Ok(ImportedHistorySidebarPage { sessions, has_more })
}

pub fn query_imported_recent_paths_from_conn(
    conn: &Connection,
    source: &str,
    limit: usize,
) -> Result<Vec<ImportedHistoryRecentPath>, String> {
    let rows = query_cached_sessions_from_conn(conn, source, i64::MAX as usize, 0)?;
    Ok(recent_paths_from_rows(
        &rows
            .into_iter()
            .map(|session| session.to_row())
            .collect::<Vec<_>>(),
    )
    .into_iter()
    .take(effective_limit(limit))
    .collect())
}

/// Cached session counts for a source, split into top-level sessions and child
/// sub-agent sessions. A session is a sub-agent when it has a parent — either a
/// non-empty `parent_session_id` or a `:subagent:` id segment — which is exactly
/// the signal the sidebar uses to collapse a session under its parent
/// (`isPrimarySessionListSession`), independent of `listable`. This matters
/// because sub-agents are represented two ways: Cursor hides them
/// (`listable = 0`) while Claude Code / Codex / Cline keep them listable but
/// collapsed. Returns `(sessions, subagents)`; the two sum to the source total.
pub fn source_session_counts_from_conn(
    conn: &Connection,
    source: &str,
) -> Result<(usize, usize), String> {
    // Keep this predicate in sync with `isPrimarySessionListSession`
    // (src/util/session/sessionVisibility.ts): a child = has a parent id.
    const IS_SUBAGENT: &str =
        "(COALESCE(parent_session_id, '') != '' OR source_session_id LIKE '%:subagent:%')";
    let sql = format!(
        "SELECT \
            COALESCE(SUM(CASE WHEN {IS_SUBAGENT} THEN 0 ELSE 1 END), 0), \
            COALESCE(SUM(CASE WHEN {IS_SUBAGENT} THEN 1 ELSE 0 END), 0) \
         FROM imported_history_session_cache WHERE source = ?1"
    );
    conn.query_row(&sql, [source], |row| {
        Ok((
            row.get::<_, i64>(0)? as usize,
            row.get::<_, i64>(1)? as usize,
        ))
    })
    .map_err(|err| format!("Failed to count imported history sessions: {err}"))
}

fn query_cached_sessions_from_conn(
    conn: &Connection,
    source: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<ImportedHistoryCachedSession>, String> {
    query_cached_sessions_by_filter_from_conn(
        conn,
        source,
        "listable = ?2 AND parent_session_id = ''",
        &[SqlValue::from(1_i64)],
        limit,
        offset,
    )
}

fn query_cached_sessions_by_filter_from_conn(
    conn: &Connection,
    source: &str,
    filter_sql: &str,
    filter_params: &[SqlValue],
    limit: usize,
    offset: usize,
) -> Result<Vec<ImportedHistoryCachedSession>, String> {
    let sql = format!(
        "SELECT source_session_id, session_id, source_path, source_record_key,
                source_mtime_ms, source_size_bytes, source_fingerprint, parser_version,
                name, created_at_ms, updated_at_ms, model, input_tokens, output_tokens,
                repo_path, branch, files_changed, lines_added, lines_removed,
                touched_files_json, listable, source_metadata_json, parent_session_id
         FROM imported_history_session_cache
         WHERE source = ?1 AND {filter_sql}
         ORDER BY updated_at_ms DESC, created_at_ms DESC, source_session_id ASC
         LIMIT ?{} OFFSET ?{}",
        filter_params.len() + 2,
        filter_params.len() + 3
    );
    let params = std::iter::once(SqlValue::from(source.to_string()))
        .chain(filter_params.iter().cloned())
        .chain([SqlValue::from(limit as i64), SqlValue::from(offset as i64)])
        .collect::<Vec<_>>();
    let mut stmt = conn.prepare(&sql).map_err(|err| {
        format!("Failed to prepare imported history cache query for {source}: {err}")
    })?;
    let rows = stmt
        .query_map(params_from_iter(params), |row| {
            let model: String = row.get(11)?;
            let repo_path: String = row.get(14)?;
            let branch: String = row.get(15)?;
            let touched_files_json: String = row.get(19)?;
            let touched_files =
                serde_json::from_str::<Vec<String>>(&touched_files_json).map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(19, Type::Text, Box::new(err))
                })?;
            let parent_session_id: String = row.get(22)?;
            Ok(ImportedHistoryCachedSession {
                source_session_id: row.get(0)?,
                session_id: row.get(1)?,
                source_path: row.get(2)?,
                source_record_key: row.get(3)?,
                source_mtime_ms: row.get(4)?,
                source_size_bytes: row.get(5)?,
                source_fingerprint: row.get(6)?,
                parser_version: row.get(7)?,
                name: row.get(8)?,
                created_at_ms: row.get(9)?,
                updated_at_ms: row.get(10)?,
                model: non_empty_string(model),
                input_tokens: row.get(12)?,
                output_tokens: row.get(13)?,
                repo_path: non_empty_string(repo_path),
                branch: non_empty_string(branch),
                impact: ImportedHistoryImpactStats {
                    files_changed: row.get(16)?,
                    lines_added: row.get(17)?,
                    lines_removed: row.get(18)?,
                    touched_files,
                },
                listable: row.get::<_, i64>(20)? != 0,
                source_metadata_json: non_empty_string(row.get(21)?),
                parent_session_id: non_empty_string(parent_session_id),
            })
        })
        .map_err(|err| {
            format!("Failed to query imported history cache rows for {source}: {err}")
        })?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|err| {
            format!("Failed to read imported history cache row for {source}: {err}")
        })?);
    }
    Ok(sessions)
}

pub fn query_cached_session_from_conn(
    conn: &Connection,
    source: &str,
    source_session_id: &str,
) -> Result<Option<ImportedHistoryCachedSession>, String> {
    let sessions = query_cached_sessions_by_filter_from_conn(
        conn,
        source,
        "source_session_id = ?2",
        &[SqlValue::from(source_session_id.to_string())],
        1,
        0,
    )?;
    Ok(sessions.into_iter().next())
}

/// Resolve one canonical session ID without scanning paginated source rows.
///
/// Sidebar deep links use the canonical ID rendered by the rest of ORGII,
/// while the cache primary key is `(source, source_session_id)`. Resolve the
/// source first, then reuse the canonical row decoder so the targeted and
/// paginated paths cannot drift in field handling.
pub fn query_cached_session_by_session_id_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<(String, ImportedHistoryCachedSession)>, String> {
    let source = conn
        .query_row(
            "SELECT source FROM imported_history_session_cache WHERE session_id = ?1 LIMIT 1",
            [session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| {
            format!("Failed to resolve imported history source for {session_id}: {err}")
        })?;
    let Some(source) = source else {
        return Ok(None);
    };
    let sessions = query_cached_sessions_by_filter_from_conn(
        conn,
        &source,
        "session_id = ?2",
        &[SqlValue::from(session_id.to_string())],
        1,
        0,
    )?;
    Ok(sessions.into_iter().next().map(|session| (source, session)))
}

pub fn query_cached_sessions_for_source_from_conn(
    conn: &Connection,
    source: &str,
) -> Result<Vec<ImportedHistoryCachedSession>, String> {
    query_cached_sessions_by_filter_from_conn(
        conn,
        source,
        "listable = ?2",
        &[SqlValue::from(1_i64)],
        i64::MAX as usize,
        0,
    )
}

/// Query cached sessions for one repository, including child/subagent rows
/// that list surfaces intentionally hide. A child without its own repository
/// inherits the parent's match in SQL so reconciliation stays repo-scoped
/// without loading every historical session into memory.
pub fn query_cached_sessions_for_repo_from_conn(
    conn: &Connection,
    source: &str,
    repo_path: &str,
) -> Result<Vec<ImportedHistoryCachedSession>, String> {
    query_cached_sessions_by_filter_from_conn(
        conn,
        source,
        "(repo_path = ?2 OR (
            repo_path = '' AND parent_session_id IN (
                SELECT parent_match.session_id
                FROM imported_history_session_cache parent_match
                WHERE parent_match.source = ?1 AND parent_match.repo_path = ?2
            )
        ))",
        &[SqlValue::from(repo_path.to_string())],
        i64::MAX as usize,
        0,
    )
}

pub fn query_cached_sessions_in_range_from_conn(
    conn: &Connection,
    source: &str,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<ImportedHistoryCachedSession>, String> {
    query_cached_sessions_by_filter_from_conn(
        conn,
        source,
        "created_at_ms >= ?2 AND created_at_ms <= ?3 AND listable = ?4",
        &[
            SqlValue::from(start_ms),
            SqlValue::from(end_ms),
            SqlValue::from(1_i64),
        ],
        i64::MAX as usize,
        0,
    )
}

fn non_empty_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
