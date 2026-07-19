//! Warp conversation discovery and imported-history cache synchronization.

use serde_json::json;

use super::*;

pub(super) fn sync_warp_history_cache(cache_conn: &mut Connection) -> Result<(), String> {
    let Some((source_conn, db_path)) = open_warp_db()? else {
        imported_cache::sync_source_cache_from_conn(
            cache_conn,
            SOURCE_WARP,
            Vec::new(),
            Vec::new(),
        )?;
        return Ok(());
    };

    let (source_mtime_ms, source_size_bytes) =
        imported_paths::file_metadata_signature(&db_path, "Warp")?;
    let sidecar_signature = imported_paths::sqlite_sidecar_signature(&db_path);
    let records = list_conversation_records(&source_conn)?;
    let live_ids = records
        .iter()
        .map(|record| record.conversation_id.clone())
        .collect::<Vec<_>>();
    let mut inputs = Vec::with_capacity(records.len());

    for record in records {
        let fallback_ms = parse_warp_timestamp_ms(&record.last_modified_at).unwrap_or(0);
        let task_blobs = load_task_blobs(&source_conn, &record.conversation_id)?;
        let analysis = analyze_task_blobs(
            &format!("{WARP_SESSION_PREFIX}{}", record.conversation_id),
            &task_blobs,
            fallback_ms,
        );
        inputs.push(conversation_to_cache_input(
            record,
            analysis,
            &db_path,
            source_mtime_ms,
            source_size_bytes,
            &sidecar_signature,
        ));
    }

    imported_cache::sync_source_cache_from_conn(cache_conn, SOURCE_WARP, live_ids, inputs)
}

pub(super) fn list_conversation_records(
    conn: &Connection,
) -> Result<Vec<WarpConversationRecord>, String> {
    if !table_exists(conn, "agent_conversations")? || !table_exists(conn, "agent_tasks")? {
        return Ok(Vec::new());
    }
    let summary_expr = if column_exists(conn, "agent_conversations", "summary")? {
        "summary"
    } else {
        "NULL"
    };
    let sql = format!(
        "SELECT c.conversation_id, c.conversation_data, \
                CAST(c.last_modified_at AS TEXT), {summary_expr}, \
                (SELECT COUNT(*) FROM agent_tasks t WHERE t.conversation_id = c.conversation_id), \
                (SELECT COALESCE(SUM(LENGTH(t.task)), 0) FROM agent_tasks t WHERE t.conversation_id = c.conversation_id) \
         FROM agent_conversations c ORDER BY c.last_modified_at ASC, c.id ASC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare Warp conversation query: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WarpConversationRecord {
                conversation_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                conversation_data_json: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                last_modified_at: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                summary_json: row.get(3)?,
                task_count: row.get::<_, Option<i64>>(4)?.unwrap_or_default(),
                task_bytes: row.get::<_, Option<i64>>(5)?.unwrap_or_default(),
            })
        })
        .map_err(|err| format!("Failed to query Warp conversations: {err}"))?;

    let mut records = Vec::new();
    for row in rows {
        let record = row.map_err(|err| format!("Failed to read Warp conversation row: {err}"))?;
        if !record.conversation_id.trim().is_empty() {
            records.push(record);
        }
    }
    Ok(records)
}

pub(super) fn conversation_to_cache_input(
    record: WarpConversationRecord,
    analysis: WarpTaskAnalysis,
    db_path: &Path,
    source_mtime_ms: i64,
    source_size_bytes: i64,
    sidecar_signature: &str,
) -> ImportedHistoryCacheInput {
    let summary = record
        .summary_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<WarpConversationSummary>(raw).ok())
        .unwrap_or_default();
    let data = serde_json::from_str::<WarpConversationData>(&record.conversation_data_json)
        .unwrap_or_default();
    let usage = data.conversation_usage_metadata.unwrap_or_default();
    let total_tokens = usage
        .token_usage
        .iter()
        .map(|item| {
            i64::from(item.warp_tokens)
                + i64::from(item.byok_tokens)
                + i64::from(item.custom_endpoint_tokens)
        })
        .sum();
    let usage_model = usage
        .token_usage
        .iter()
        .rev()
        .map(|item| item.model_id.trim())
        .find(|model| !model.is_empty())
        .map(str::to_string);

    let title = non_empty(Some(&summary.title))
        .or_else(|| non_empty(analysis.root_description.as_deref()))
        .or_else(|| non_empty(Some(&summary.initial_query)))
        .or_else(|| non_empty(analysis.initial_query.as_deref()))
        .or_else(|| non_empty(data.agent_name.as_deref()))
        .unwrap_or_else(|| "Warp conversation".to_string());
    let fallback_updated_at = parse_warp_timestamp_ms(&record.last_modified_at).unwrap_or(0);
    let created_at_ms = analysis.created_at_ms.unwrap_or(fallback_updated_at);
    let updated_at_ms = analysis.updated_at_ms.unwrap_or(fallback_updated_at);
    let parent_session_id = non_empty(data.parent_conversation_id.as_deref())
        .map(|parent| format!("{WARP_SESSION_PREFIX}{parent}"));
    let source_fingerprint = warp_source_fingerprint(&record, sidecar_signature);
    let listable =
        !data.is_remote_child && !summary.is_unlisted_auto_code_diff && !analysis.chunks.is_empty();
    let source_metadata_json = serde_json::to_string(&json!({
        "initialQuery": non_empty(Some(&summary.initial_query)).or(analysis.initial_query),
        "taskCount": record.task_count,
    }))
    .ok();

    ImportedHistoryCacheInput {
        source: SOURCE_WARP,
        source_session_id: record.conversation_id.clone(),
        session_id: format!("{WARP_SESSION_PREFIX}{}", record.conversation_id),
        source_path: db_path.to_string_lossy().to_string(),
        source_record_key: record.conversation_id,
        source_mtime_ms,
        source_size_bytes,
        source_fingerprint,
        parser_version: WARP_METADATA_PARSER_VERSION,
        name: imported_history::truncate_name(&title, 200),
        created_at_ms,
        updated_at_ms,
        model: analysis.model.or(usage_model),
        input_tokens: total_tokens,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        repo_path: non_empty(summary.initial_working_directory.as_deref()),
        branch: None,
        impact: analysis.impact,
        listable,
        source_metadata_json,
        parent_session_id,
    }
}

pub(super) fn warp_source_fingerprint(
    record: &WarpConversationRecord,
    sidecar_signature: &str,
) -> String {
    [
        record.conversation_id.as_str(),
        record.conversation_data_json.as_str(),
        record.summary_json.as_deref().unwrap_or_default(),
        record.last_modified_at.as_str(),
        &record.task_count.to_string(),
        &record.task_bytes.to_string(),
        sidecar_signature,
    ]
    .join("|")
}
