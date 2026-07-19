use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use core_types::activity::ActivityChunk;
use serde_json::{json, Value};

use crate::sources::imported_history::{self, ImportedToolCall};

use super::desktop_exec::codex_tool_output_text;
use super::*;

pub(crate) struct PendingBackgroundToolCall {
    calls: Vec<ImportedToolCall>,
    latest_output: String,
}

#[derive(Debug)]
pub(crate) struct CodexExecResult {
    output: String,
    session_id: Option<String>,
    exit_code: Option<i64>,
}

pub fn load_codex_app_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<ActivityChunk>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Codex history {}: {err}", path.display()))?;
    let reader = BufReader::new(file);

    let mut chunks = Vec::new();
    let mut pending_tool_calls: HashMap<String, Vec<ImportedToolCall>> = HashMap::new();
    let mut background_tool_calls: HashMap<String, PendingBackgroundToolCall> = HashMap::new();
    let mut sequence = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Codex history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: CodexJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let created_at = parsed
            .timestamp
            .as_deref()
            .map(imported_history::normalize_created_at)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let Some(payload_type) = parsed.payload.get("type").and_then(Value::as_str) else {
            continue;
        };

        match payload_type {
            "user_message" => {
                if let Some(message) = user_message_from_payload(&parsed.payload) {
                    chunks.push(imported_history::user_message_chunk(
                        session_id,
                        CODEX_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        &message,
                    ));
                    sequence += 1;
                }
            }
            "agent_message" => {
                if let Some(message) = parsed.payload.get("message").and_then(Value::as_str) {
                    chunks.push(imported_history::assistant_message_chunk(
                        session_id,
                        CODEX_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        message,
                    ));
                    sequence += 1;
                }
            }
            "message" => {
                if parsed.payload.get("role").and_then(Value::as_str) == Some("assistant") {
                    if let Some(text) = content_text_from_payload(&parsed.payload) {
                        chunks.push(imported_history::assistant_message_chunk(
                            session_id,
                            CODEX_PROVIDER_SLUG,
                            sequence,
                            &created_at,
                            &text,
                        ));
                        sequence += 1;
                    }
                }
            }
            "reasoning" | "agent_reasoning" => {
                if let Some(text) = reasoning_text_from_payload(&parsed.payload) {
                    chunks.push(imported_history::thinking_chunk(
                        session_id,
                        CODEX_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        &text,
                    ));
                    sequence += 1;
                }
            }
            "function_call" => {
                if let Some((call_id, calls)) =
                    pending_tool_calls_from_payload(&parsed.payload, &created_at)
                {
                    pending_tool_calls.insert(call_id, calls);
                }
            }
            "custom_tool_call" => {
                if let Some((call_id, calls)) =
                    pending_custom_tool_calls_from_payload(&parsed.payload, &created_at)
                {
                    pending_tool_calls.insert(call_id, calls);
                }
            }
            "web_search_call" => {
                if let Some(call) = web_search_call_from_payload(&parsed.payload, &created_at) {
                    chunks.push(codex_tool_call_chunk(session_id, sequence, &call, "", None));
                    sequence += 1;
                }
            }
            "function_call_output" | "custom_tool_call_output" => {
                let call_id = parsed.payload.get("call_id").and_then(Value::as_str);
                if let Some(call_id) = call_id {
                    if let Some(calls) = pending_tool_calls.remove(call_id) {
                        let output_value = parsed.payload.get("output");
                        let output = codex_tool_output_text(output_value);
                        if let Some(cell_id) = wait_cell_id(&calls) {
                            let cell_key = background_cell_key(cell_id);
                            if let Some(mut background) = background_tool_calls.remove(&cell_key) {
                                if let Some(next_cell_id) = background_cell_id(&output) {
                                    background.latest_output = output;
                                    background_tool_calls
                                        .insert(background_cell_key(&next_cell_id), background);
                                } else {
                                    let final_output = if output.trim().is_empty() {
                                        background.latest_output
                                    } else {
                                        output
                                    };
                                    resolve_codex_tool_outputs(
                                        session_id,
                                        background.calls,
                                        output_value,
                                        &final_output,
                                        &mut chunks,
                                        &mut sequence,
                                        &mut background_tool_calls,
                                    );
                                }
                                continue;
                            }
                        }
                        if let Some(cell_id) = background_cell_id(&output) {
                            background_tool_calls.insert(
                                background_cell_key(&cell_id),
                                PendingBackgroundToolCall {
                                    calls,
                                    latest_output: output,
                                },
                            );
                            continue;
                        }
                        resolve_codex_tool_outputs(
                            session_id,
                            calls,
                            output_value,
                            &output,
                            &mut chunks,
                            &mut sequence,
                            &mut background_tool_calls,
                        );
                    }
                }
            }
            _ => {}
        }
    }

    for calls in pending_tool_calls.into_values() {
        for call in calls {
            chunks.push(codex_tool_call_chunk(session_id, sequence, &call, "", None));
            sequence += 1;
        }
    }
    for background in background_tool_calls.into_values() {
        if background
            .calls
            .iter()
            .all(|call| call.canonical_name == imported_history::FUNCTION_AWAIT_OUTPUT)
        {
            continue;
        }
        let outputs = output_parts_for_tool_calls(&background.calls, &background.latest_output);
        for (call, output) in background.calls.iter().zip(outputs.iter()) {
            chunks.push(codex_tool_call_chunk(
                session_id, sequence, call, output, None,
            ));
            sequence += 1;
        }
    }

    Ok(chunks)
}

pub(crate) fn resolve_codex_tool_outputs(
    transcript_session_id: &str,
    calls: Vec<ImportedToolCall>,
    output_value: Option<&Value>,
    fallback_output: &str,
    chunks: &mut Vec<ActivityChunk>,
    sequence: &mut usize,
    background_tool_calls: &mut HashMap<String, PendingBackgroundToolCall>,
) {
    let mut results = codex_exec_results(output_value);
    if results.len() == calls.len() {
        for (call, result) in calls.into_iter().zip(results.drain(..)) {
            resolve_codex_call_group(
                transcript_session_id,
                vec![call],
                result,
                chunks,
                sequence,
                background_tool_calls,
            );
        }
        return;
    }
    if results.len() == 1 {
        resolve_codex_call_group(
            transcript_session_id,
            calls,
            results.remove(0),
            chunks,
            sequence,
            background_tool_calls,
        );
        return;
    }

    emit_codex_call_group(
        transcript_session_id,
        calls,
        fallback_output,
        None,
        chunks,
        sequence,
    );
}

pub(crate) fn resolve_codex_call_group(
    transcript_session_id: &str,
    calls: Vec<ImportedToolCall>,
    result: CodexExecResult,
    chunks: &mut Vec<ActivityChunk>,
    sequence: &mut usize,
    background_tool_calls: &mut HashMap<String, PendingBackgroundToolCall>,
) {
    if calls.len() == 1 && calls[0].canonical_name == imported_history::FUNCTION_AWAIT_OUTPUT {
        resolve_write_stdin_call(
            transcript_session_id,
            calls.into_iter().next().expect("single continuation call"),
            result,
            chunks,
            sequence,
            background_tool_calls,
        );
        return;
    }

    if result.exit_code.is_none() {
        if let Some(session_id) = result.session_id.as_deref() {
            background_tool_calls.insert(
                background_session_key(session_id),
                PendingBackgroundToolCall {
                    calls,
                    latest_output: result.output,
                },
            );
            return;
        }
    }

    emit_codex_call_group(
        transcript_session_id,
        calls,
        &result.output,
        result.exit_code,
        chunks,
        sequence,
    );
}

pub(crate) fn resolve_write_stdin_call(
    transcript_session_id: &str,
    continuation: ImportedToolCall,
    result: CodexExecResult,
    chunks: &mut Vec<ActivityChunk>,
    sequence: &mut usize,
    background_tool_calls: &mut HashMap<String, PendingBackgroundToolCall>,
) {
    let source_session_id = continuation
        .args
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(mut background) =
        background_tool_calls.remove(&background_session_key(source_session_id))
    else {
        emit_codex_call_group(
            transcript_session_id,
            vec![continuation],
            &result.output,
            result.exit_code,
            chunks,
            sequence,
        );
        return;
    };

    record_stdin_event(&mut background.calls, &continuation);
    append_incremental_output(&mut background.latest_output, &result.output);

    if result.exit_code.is_none() {
        if let Some(next_session_id) = result.session_id.as_deref() {
            background_tool_calls.insert(background_session_key(next_session_id), background);
            return;
        }
    }

    emit_codex_call_group(
        transcript_session_id,
        background.calls,
        &background.latest_output,
        result.exit_code,
        chunks,
        sequence,
    );
}

pub(crate) fn record_stdin_event(calls: &mut [ImportedToolCall], continuation: &ImportedToolCall) {
    let chars = continuation
        .args
        .get("chars")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if chars.is_empty() {
        return;
    }
    let kind = if chars == "\u{3}" {
        "interrupt"
    } else {
        "input"
    };
    let event = json!({
        "kind": kind,
        "chars": chars,
        "created_at": continuation.created_at,
    });
    for call in calls {
        let Some(args) = call.args.as_object_mut() else {
            continue;
        };
        let events = args
            .entry("stdin_events")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut();
        if let Some(events) = events {
            events.push(event.clone());
        }
    }
}

pub(crate) fn append_incremental_output(existing: &mut String, next: &str) {
    if !next.is_empty() {
        existing.push_str(next);
    }
}

pub(crate) fn emit_codex_call_group(
    transcript_session_id: &str,
    calls: Vec<ImportedToolCall>,
    output: &str,
    exit_code: Option<i64>,
    chunks: &mut Vec<ActivityChunk>,
    sequence: &mut usize,
) {
    let outputs = output_parts_for_tool_calls(&calls, output);
    for (call, output) in calls.iter().zip(outputs.iter()) {
        chunks.push(codex_tool_call_chunk(
            transcript_session_id,
            *sequence,
            call,
            output,
            exit_code,
        ));
        *sequence += 1;
    }
}

pub(crate) fn codex_exec_results(output: Option<&Value>) -> Vec<CodexExecResult> {
    let parts = match output {
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .collect::<Vec<_>>(),
        Some(Value::String(text)) => vec![text.as_str()],
        _ => Vec::new(),
    };

    let mut results: Vec<CodexExecResult> = Vec::new();
    for part in parts {
        if let Some(result) = codex_exec_result_from_text(part) {
            results.push(result);
        } else if !is_codex_script_wrapper_text(part) {
            if let Some(result) = results.last_mut() {
                append_incremental_output(&mut result.output, part);
            }
        }
    }
    results
}

pub(crate) fn codex_exec_result_from_text(text: &str) -> Option<CodexExecResult> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    let object = value.as_object()?;
    if !object.contains_key("output")
        && !object.contains_key("session_id")
        && !object.contains_key("sessionId")
        && !object.contains_key("exit_code")
        && !object.contains_key("exitCode")
    {
        return None;
    }
    Some(CodexExecResult {
        output: object
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        session_id: object
            .get("session_id")
            .or_else(|| object.get("sessionId"))
            .and_then(json_scalar_string),
        exit_code: object
            .get("exit_code")
            .or_else(|| object.get("exitCode"))
            .and_then(Value::as_i64),
    })
}

pub(crate) fn json_scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(crate) fn is_codex_script_wrapper_text(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with("Script completed")
        || trimmed.starts_with("Script running with cell ID")
        || trimmed.starts_with("Script failed")
        || trimmed.starts_with("Script error")
}

pub(crate) fn background_cell_key(cell_id: &str) -> String {
    format!("cell:{cell_id}")
}

pub(crate) fn background_session_key(session_id: &str) -> String {
    format!("session:{session_id}")
}

pub(crate) fn background_cell_id(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Script running with cell ID ")
            .map(str::trim)
            .filter(|cell_id| !cell_id.is_empty())
            .map(str::to_string)
    })
}

pub(crate) fn wait_cell_id(calls: &[ImportedToolCall]) -> Option<&str> {
    let [call] = calls else {
        return None;
    };
    if normalize_tool_name_key(&call.raw_name) != "wait" {
        return None;
    }
    call.args.get("cell_id").and_then(Value::as_str)
}
