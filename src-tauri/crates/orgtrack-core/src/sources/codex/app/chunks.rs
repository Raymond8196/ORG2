use core_types::activity::ActivityChunk;
use serde_json::{json, Value};

use crate::sources::imported_history::{self, ImportedToolCall};

use super::desktop_exec::{
    codex_tool_exit_code, codex_tool_output_failed, normalize_codex_exec_tool_calls,
};
use super::*;

pub(crate) fn codex_tool_call_chunk(
    session_id: &str,
    sequence: usize,
    call: &ImportedToolCall,
    output: &str,
    structured_exit_code: Option<i64>,
) -> ActivityChunk {
    let mut chunk =
        imported_history::tool_call_chunk(session_id, CODEX_PROVIDER_SLUG, sequence, call, output);
    if call.canonical_name == imported_history::FUNCTION_CODE_SEARCH {
        if let Some(result) = chunk.result.as_object_mut() {
            result.insert("content".to_string(), Value::String(output.to_string()));
            let matches = parse_rg_output_matches(output)
                .into_iter()
                .map(|(file, line, content)| {
                    json!({
                        "file": file,
                        "line": line,
                        "content": content,
                    })
                })
                .collect::<Vec<_>>();
            result.insert("matches".to_string(), Value::Array(matches));
        }
    }
    let exit_code = structured_exit_code.or_else(|| codex_tool_exit_code(output));
    let failed = codex_tool_output_failed(output, exit_code);
    if let Some(result) = chunk.result.as_object_mut() {
        if let Some(exit_code) = exit_code {
            result.insert("exit_code".to_string(), json!(exit_code));
        }
        if failed {
            result.insert("success".to_string(), Value::Bool(false));
            result.insert("status".to_string(), Value::String("failed".to_string()));
            result.insert("is_error".to_string(), Value::Bool(true));
            result.insert(
                "failure".to_string(),
                json!({
                    "command": call.args.get("command").and_then(Value::as_str).unwrap_or_default(),
                    "stdout": "",
                    "stderr": output,
                    "exitCode": exit_code,
                }),
            );
        }
    }
    chunk
}

pub(crate) fn output_parts_for_tool_calls(calls: &[ImportedToolCall], output: &str) -> Vec<String> {
    if calls.len() <= 1 {
        return vec![output.to_string()];
    }

    // A multiline Desktop shell script may normalize to several reads followed
    // by a different final operation (for example three `sed` reads then
    // `rg`). Each bounded read consumes its known number of lines; the final
    // tool receives the remainder.
    let bounded_prefix_limits = calls[..calls.len() - 1]
        .iter()
        .map(read_line_limit_from_call)
        .collect::<Option<Vec<_>>>();
    let Some(limits) = bounded_prefix_limits else {
        return vec![output.to_string(); calls.len()];
    };

    let lines = output.split_inclusive('\n').collect::<Vec<_>>();
    let mut cursor = 0usize;
    calls
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let remaining = lines.len().saturating_sub(cursor);
            let take = if index + 1 == calls.len() {
                remaining
            } else {
                limits[index].min(remaining)
            };
            let part = lines[cursor..cursor.saturating_add(take)].concat();
            cursor = cursor.saturating_add(take);
            part
        })
        .collect()
}

pub(crate) fn read_line_limit_from_call(call: &ImportedToolCall) -> Option<usize> {
    if call.canonical_name != imported_history::FUNCTION_READ_FILE {
        return None;
    }
    call.args
        .get("limit")
        .and_then(Value::as_i64)
        .and_then(|value| usize::try_from(value).ok())
}

pub(crate) fn pending_tool_calls_from_payload(
    payload: &Value,
    created_at: &str,
) -> Option<(String, Vec<ImportedToolCall>)> {
    let call_id = payload.get("call_id")?.as_str()?.to_string();
    let raw_name = payload.get("name")?.as_str()?.to_string();
    let arguments = payload
        .get("arguments")
        .and_then(Value::as_str)
        .map(imported_history::parse_inner_json)
        .unwrap_or_else(|| json!({}));
    let normalized_calls = normalize_codex_tool_calls(&raw_name, arguments);
    let call_count = normalized_calls.len();
    if call_count == 0 {
        return None;
    }
    let calls = normalized_calls
        .into_iter()
        .enumerate()
        .map(|(index, (canonical_name, args))| ImportedToolCall {
            call_id: split_call_id(&call_id, index, call_count),
            raw_name: raw_name.clone(),
            canonical_name,
            args,
            created_at: created_at.to_string(),
        })
        .collect();
    Some((call_id, calls))
}

pub(crate) fn pending_custom_tool_calls_from_payload(
    payload: &Value,
    created_at: &str,
) -> Option<(String, Vec<ImportedToolCall>)> {
    let call_id = payload.get("call_id")?.as_str()?.to_string();
    let raw_name = payload.get("name")?.as_str()?.to_string();
    let input = payload
        .get("input")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let normalized_calls = if normalize_tool_name_key(&raw_name) == "exec" {
        normalize_codex_exec_tool_calls(input)
    } else {
        let args = if raw_name == "apply_patch" {
            json!({ "patch": input })
        } else {
            json!({ "input": input })
        };
        normalize_codex_tool_calls(&raw_name, args)
    };
    let call_count = normalized_calls.len();
    if call_count == 0 {
        return None;
    }
    let calls = normalized_calls
        .into_iter()
        .enumerate()
        .map(|(index, (canonical_name, args))| ImportedToolCall {
            call_id: split_call_id(&call_id, index, call_count),
            raw_name: raw_name.clone(),
            canonical_name,
            args,
            created_at: created_at.to_string(),
        })
        .collect();
    Some((call_id, calls))
}

pub(crate) fn web_search_call_from_payload(payload: &Value, created_at: &str) -> Option<ImportedToolCall> {
    let call_id = payload.get("id")?.as_str()?.to_string();
    let action = payload.get("action").cloned().unwrap_or_else(|| json!({}));
    Some(ImportedToolCall {
        call_id,
        raw_name: "web_search_call".to_string(),
        canonical_name: "web_search".to_string(),
        args: normalize_web_search_args(action),
        created_at: created_at.to_string(),
    })
}

pub(crate) fn split_call_id(call_id: &str, index: usize, total: usize) -> String {
    if total <= 1 {
        call_id.to_string()
    } else {
        format!("{call_id}:part-{index}")
    }
}

pub(crate) fn parse_rg_output_matches(output: &str) -> Vec<(String, i64, String)> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, ':');
            let file = parts.next()?.trim();
            let line_number = parts.next()?.parse::<i64>().ok()?;
            let content = parts.next().unwrap_or_default();
            if file.is_empty() {
                return None;
            }
            Some((file.to_string(), line_number, content.to_string()))
        })
        .collect()
}
