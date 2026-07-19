//! Warp task protobuf decoding and `ActivityChunk` projection.

use serde_json::json;

use super::*;

pub(super) fn analyze_task_blobs(
    session_id: &str,
    task_blobs: &[Vec<u8>],
    fallback_ms: i64,
) -> WarpTaskAnalysis {
    let fallback_created_at = imported_history::epoch_ms_to_iso(fallback_ms);
    let mut task_values = Vec::new();
    for blob in task_blobs {
        if let Ok(task) = decode_task_json(blob) {
            task_values.push(task);
        }
    }

    let mut analysis = WarpTaskAnalysis::default();
    analysis.root_description = task_values
        .iter()
        .find(|task| is_root_task(task))
        .and_then(|task| field_str(task, &["description"]))
        .and_then(|value| non_empty(Some(value)));

    let mut messages = Vec::new();
    for (task_index, task) in task_values.iter().enumerate() {
        let Some(task_messages) = field(task, &["messages"]).and_then(Value::as_array) else {
            continue;
        };
        for (message_index, message) in task_messages.iter().enumerate() {
            let timestamp_ms = field(message, &["timestamp"]).and_then(timestamp_value_to_epoch_ms);
            let created_at = field(message, &["timestamp"])
                .and_then(timestamp_value_to_iso)
                .unwrap_or_else(|| fallback_created_at.clone());
            messages.push(OrderedMessage {
                task_index,
                message_index,
                timestamp_ms,
                created_at,
                value: message.clone(),
            });
        }
    }
    messages.sort_by_key(|message| {
        (
            message.timestamp_ms.unwrap_or(i64::MAX),
            message.task_index,
            message.message_index,
        )
    });

    analysis.created_at_ms = messages.iter().filter_map(|item| item.timestamp_ms).min();
    analysis.updated_at_ms = messages.iter().filter_map(|item| item.timestamp_ms).max();

    let tool_results = messages
        .iter()
        .filter_map(|message| {
            let result = field(&message.value, &["toolCallResult", "tool_call_result"])?;
            let call_id = field_str(result, &["toolCallId", "tool_call_id"])?;
            Some((call_id.to_string(), result.clone()))
        })
        .collect::<HashMap<_, _>>();

    for (sequence, message) in messages.iter().enumerate() {
        if let Some(user_query) = field(&message.value, &["userQuery", "user_query"]) {
            if let Some(query) = field_str(user_query, &["query"]).and_then(|q| non_empty(Some(q)))
            {
                if analysis.initial_query.is_none() {
                    analysis.initial_query = Some(query.clone());
                }
                analysis.chunks.push(imported_history::user_message_chunk(
                    session_id,
                    WARP_PROVIDER_SLUG,
                    sequence,
                    &message.created_at,
                    &query,
                ));
            }
            continue;
        }
        if let Some(agent_output) = field(&message.value, &["agentOutput", "agent_output"]) {
            if let Some(text) = field_str(agent_output, &["text"]).and_then(|t| non_empty(Some(t)))
            {
                analysis
                    .chunks
                    .push(imported_history::assistant_message_chunk(
                        session_id,
                        WARP_PROVIDER_SLUG,
                        sequence,
                        &message.created_at,
                        &text,
                    ));
            }
            continue;
        }
        if let Some(reasoning) = field(&message.value, &["agentReasoning", "agent_reasoning"]) {
            if let Some(text) =
                field_str(reasoning, &["reasoning"]).and_then(|t| non_empty(Some(t)))
            {
                analysis.chunks.push(imported_history::thinking_chunk(
                    session_id,
                    WARP_PROVIDER_SLUG,
                    sequence,
                    &message.created_at,
                    &text,
                ));
            }
            continue;
        }
        if let Some(model_used) = field(&message.value, &["modelUsed", "model_used"]) {
            analysis.model = field_str(model_used, &["modelDisplayName", "model_display_name"])
                .and_then(|model| non_empty(Some(model)))
                .or_else(|| {
                    field_str(model_used, &["modelId", "model_id"])
                        .and_then(|model| non_empty(Some(model)))
                })
                .or(analysis.model);
            continue;
        }
        let Some(tool_call) = field(&message.value, &["toolCall", "tool_call"]) else {
            continue;
        };
        let Some((raw_name, payload)) = tool_variant(tool_call) else {
            continue;
        };
        accumulate_impact(&mut analysis.impact, raw_name, payload);
        let call_id = field_str(tool_call, &["toolCallId", "tool_call_id"])
            .filter(|id| !id.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("warp-{sequence}"));
        let (canonical_name, args) = normalize_warp_tool_call(raw_name, payload.clone());
        let output = tool_results
            .get(&call_id)
            .map(tool_result_text)
            .unwrap_or_default();
        let call = ImportedToolCall {
            call_id,
            raw_name: camel_to_snake(raw_name),
            canonical_name,
            args,
            created_at: message.created_at.clone(),
        };
        analysis.chunks.push(imported_history::tool_call_chunk(
            session_id,
            WARP_PROVIDER_SLUG,
            sequence,
            &call,
            &output,
        ));
    }

    analysis
}

fn decode_task_json(blob: &[u8]) -> Result<Value, String> {
    let descriptor = warp_descriptor_pool()?
        .get_message_by_name(WARP_TASK_PROTO_NAME)
        .ok_or_else(|| format!("Missing Warp protobuf descriptor: {WARP_TASK_PROTO_NAME}"))?;
    let message = DynamicMessage::decode(descriptor, blob)
        .map_err(|err| format!("Failed to decode Warp task protobuf: {err}"))?;
    serde_json::to_value(message).map_err(|err| format!("Failed to project Warp task JSON: {err}"))
}

pub(super) fn warp_descriptor_pool() -> Result<&'static DescriptorPool, String> {
    WARP_DESCRIPTOR_POOL.as_ref().map_err(Clone::clone)
}

fn normalize_warp_tool_call(raw_name: &str, payload: Value) -> (String, Value) {
    match raw_name {
        "runShellCommand" | "run_shell_command" => {
            let command = field_str(&payload, &["command"]).unwrap_or_default();
            (
                imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
                json!({ "command": command, "cmd": command, "payload": payload }),
            )
        }
        "readFiles" | "read_files" => (imported_history::FUNCTION_READ_FILE.to_string(), payload),
        "applyFileDiffs" | "apply_file_diffs" | "editDocuments" | "edit_documents"
        | "createDocuments" | "create_documents" => {
            let file_path = first_edited_file_path(&payload).unwrap_or_default();
            (
                imported_history::FUNCTION_EDIT_FILE.to_string(),
                json!({
                    "action": camel_to_snake(raw_name),
                    "file_path": file_path,
                    "payload": payload,
                }),
            )
        }
        "grep" | "searchCodebase" | "search_codebase" => {
            (imported_history::FUNCTION_CODE_SEARCH.to_string(), payload)
        }
        "fileGlob" | "file_glob" | "fileGlobV2" | "file_glob_v2" => (
            imported_history::FUNCTION_GLOB_FILE_SEARCH.to_string(),
            payload,
        ),
        _ => (camel_to_snake(raw_name), payload),
    }
}

fn tool_variant(tool_call: &Value) -> Option<(&str, &Value)> {
    tool_call.as_object()?.iter().find_map(|(key, value)| {
        (!matches!(key.as_str(), "toolCallId" | "tool_call_id")).then_some((key.as_str(), value))
    })
}

fn tool_result_text(result: &Value) -> String {
    let payload = result
        .as_object()
        .and_then(|object| {
            object.iter().find_map(|(key, value)| {
                (!matches!(key.as_str(), "toolCallId" | "tool_call_id")).then_some(value)
            })
        })
        .unwrap_or(result);
    serde_json::to_string(payload).unwrap_or_default()
}

fn accumulate_impact(impact: &mut ImportedHistoryImpactStats, raw_name: &str, payload: &Value) {
    if !matches!(raw_name, "applyFileDiffs" | "apply_file_diffs") {
        return;
    }
    let mut touched = impact
        .touched_files
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    for diff in field(payload, &["diffs"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(path) =
            field_str(diff, &["filePath", "file_path"]).and_then(|p| non_empty(Some(p)))
        {
            touched.insert(path);
        }
        impact.lines_removed += field_str(diff, &["search"])
            .map(line_count)
            .unwrap_or_default();
        impact.lines_added += field_str(diff, &["replace"])
            .map(line_count)
            .unwrap_or_default();
    }
    for new_file in field(payload, &["newFiles", "new_files"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(path) =
            field_str(new_file, &["filePath", "file_path"]).and_then(|p| non_empty(Some(p)))
        {
            touched.insert(path);
        }
        impact.lines_added += field_str(new_file, &["content"])
            .map(line_count)
            .unwrap_or_default();
    }
    for deleted_file in field(payload, &["deletedFiles", "deleted_files"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(path) =
            field_str(deleted_file, &["filePath", "file_path"]).and_then(|p| non_empty(Some(p)))
        {
            touched.insert(path);
        }
    }
    for update in field(payload, &["v4aUpdates", "v4a_updates"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(path) =
            field_str(update, &["filePath", "file_path"]).and_then(|p| non_empty(Some(p)))
        {
            touched.insert(path);
        }
        for hunk in field(update, &["hunks"])
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            impact.lines_removed += field_str(hunk, &["old"])
                .map(line_count)
                .unwrap_or_default();
            impact.lines_added += field_str(hunk, &["new"])
                .map(line_count)
                .unwrap_or_default();
        }
    }
    impact.touched_files = touched.into_iter().collect();
    impact.files_changed = impact.touched_files.len() as i64;
}

fn first_edited_file_path(payload: &Value) -> Option<String> {
    [
        "diffs",
        "newFiles",
        "new_files",
        "deletedFiles",
        "deleted_files",
        "v4aUpdates",
        "v4a_updates",
    ]
    .iter()
    .find_map(|key| {
        field(payload, &[*key])
            .and_then(Value::as_array)
            .and_then(|rows| rows.first())
            .and_then(|row| field_str(row, &["filePath", "file_path", "documentId", "document_id"]))
            .and_then(|path| non_empty(Some(path)))
    })
}

fn is_root_task(task: &Value) -> bool {
    field(task, &["dependencies"])
        .and_then(|dependencies| field_str(dependencies, &["parentTaskId", "parent_task_id"]))
        .map(|parent| parent.trim().is_empty())
        .unwrap_or(true)
}
