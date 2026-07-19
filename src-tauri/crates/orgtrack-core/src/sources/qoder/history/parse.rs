use std::collections::HashMap;
use std::fs;
use std::path::Path;

use core_types::activity::ActivityChunk;
use serde_json::Value;

use super::*;

use crate::sources::imported_history::{
    self,
    metadata::{ImportedHistoryCacheInput, SOURCE_QODER},
    ImportedToolCall,
};

pub(super) fn parse_qoder_session_meta(discovered: &QoderDiscoveredRecord) -> QoderHistoryMeta {
    let record = &discovered.record;
    let snapshot = discovered.snapshot.as_ref();
    let transcript = read_qoder_transcript(&record.source_path).unwrap_or_default();

    // The signature mtime is nanoseconds (see `file_metadata_signature`);
    // scale it down where a real epoch-ms value is needed.
    let mtime_ms = record.source_mtime_ms / 1_000_000;
    let created_at_ms = snapshot
        .map(|task| task.create_time)
        .filter(|ms| *ms > 0)
        .unwrap_or(mtime_ms);
    let updated_at_ms = snapshot
        .map(|task| task.updated_at_timestamp.max(task.last_user_query_at))
        .filter(|ms| *ms > 0)
        .unwrap_or(mtime_ms);

    let name = snapshot
        .and_then(|task| {
            [&task.title, &task.name, &task.query]
                .into_iter()
                .map(|value| value.trim())
                .find(|value| !value.is_empty())
                .map(str::to_string)
        })
        .or_else(|| first_user_text(&transcript))
        .map(|value| imported_history::truncate_name(&value, 200))
        .unwrap_or_else(|| record.source_session_id.clone());

    let repo_path = snapshot
        .map(|task| task.file_path.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let session_id = format!("{QODER_SESSION_PREFIX}{}", record.source_session_id);
    // Edits never appear in the transcript, so the +/- stats come from the
    // chat-editing snapshot store; the transcript-derived impact is kept as a
    // fallback in case a future Qoder version starts persisting tool blocks.
    let task_dir_name = record
        .source_session_id
        .split_once('/')
        .map(|(_, task)| task)
        .unwrap_or(record.source_session_id.as_str());
    let edit_impact = super::super::log_enrichment::session_edit_impact(
        task_dir_name,
        snapshot.map(|task| task.id.as_str()),
    );
    let impact = if edit_impact.files_changed > 0 {
        edit_impact
    } else {
        imported_history::impact_from_edit_chunks(&transcript_to_chunks(&session_id, &transcript))
    };

    QoderHistoryMeta {
        source_session_id: record.source_session_id.clone(),
        session_id,
        source_path: record.source_path.to_string_lossy().to_string(),
        source_record_key: record.source_record_key.clone(),
        source_mtime_ms: record.source_mtime_ms,
        source_size_bytes: record.source_size_bytes,
        source_fingerprint: record.source_fingerprint.clone(),
        name,
        created_at_ms,
        updated_at_ms,
        repo_path,
        impact,
    }
}

pub(super) fn session_meta_to_cache_input(meta: QoderHistoryMeta) -> ImportedHistoryCacheInput {
    ImportedHistoryCacheInput {
        source: SOURCE_QODER,
        source_session_id: meta.source_session_id,
        session_id: meta.session_id,
        source_path: meta.source_path,
        source_record_key: meta.source_record_key,
        source_mtime_ms: meta.source_mtime_ms,
        source_size_bytes: meta.source_size_bytes,
        source_fingerprint: meta.source_fingerprint,
        parser_version: QODER_METADATA_PARSER_VERSION,
        name: meta.name,
        created_at_ms: meta.created_at_ms,
        updated_at_ms: meta.updated_at_ms,
        // The transcript/snapshot carry no per-session model or token usage.
        model: None,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        repo_path: meta.repo_path,
        branch: None,
        impact: meta.impact,
        listable: true,
        source_metadata_json: None,
        parent_session_id: None,
    }
}

pub(super) fn transcript_to_chunks(
    session_id: &str,
    transcript: &[QoderTranscriptLine],
) -> Vec<ActivityChunk> {
    // Pass 1: collect tool results so each `tool_use` can be paired with the
    // matching `tool_result` regardless of which later line carried it.
    let mut tool_outputs: HashMap<String, Value> = HashMap::new();
    let mut tool_failures: HashMap<String, bool> = HashMap::new();
    for line in transcript {
        for block in content_blocks(&line.message.content) {
            if block_type(block) == "tool_result" {
                if let Some(id) = block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                {
                    tool_failures.insert(
                        id.to_string(),
                        block.get("is_error").and_then(Value::as_bool) == Some(true),
                    );
                    tool_outputs.insert(
                        id.to_string(),
                        block.get("content").cloned().unwrap_or(Value::Null),
                    );
                }
            }
        }
    }

    // Pass 2: emit chunks in transcript order. The lines carry no timestamps,
    // so chunk `created_at` stays empty and replay falls back to sequence
    // order.
    let mut chunks = Vec::new();
    let mut sequence = 0usize;
    for line in transcript {
        let is_user = line.role == "user";
        for block in content_blocks(&line.message.content) {
            match block_type(block) {
                "text" => {
                    let raw = block.get("text").and_then(Value::as_str).unwrap_or("");
                    let text = if is_user {
                        extract_user_query(raw)
                    } else {
                        raw.trim().to_string()
                    };
                    if text.is_empty() {
                        continue;
                    }
                    if is_user {
                        chunks.push(imported_history::user_message_chunk(
                            session_id,
                            QODER_PROVIDER_SLUG,
                            sequence,
                            "",
                            &text,
                        ));
                    } else {
                        chunks.push(imported_history::assistant_message_chunk(
                            session_id,
                            QODER_PROVIDER_SLUG,
                            sequence,
                            "",
                            &text,
                        ));
                    }
                    sequence += 1;
                }
                "thinking" => {
                    let thought = block
                        .get("thinking")
                        .or_else(|| block.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if thought.is_empty() {
                        continue;
                    }
                    chunks.push(imported_history::thinking_chunk(
                        session_id,
                        QODER_PROVIDER_SLUG,
                        sequence,
                        "",
                        thought,
                    ));
                    sequence += 1;
                }
                "tool_use" => {
                    let call_id = block
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let raw_name = block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    let output = value_to_text(tool_outputs.get(&call_id));
                    let call = ImportedToolCall {
                        call_id: call_id.clone(),
                        raw_name: raw_name.clone(),
                        // Qoder's tool vocabulary is not mapped yet; pass the
                        // raw name through so the replay renders a generic
                        // tool card instead of dropping the call.
                        canonical_name: raw_name,
                        args: block.get("input").cloned().unwrap_or(Value::Null),
                        created_at: String::new(),
                    };
                    let mut chunk = imported_history::tool_call_chunk(
                        session_id,
                        QODER_PROVIDER_SLUG,
                        sequence,
                        &call,
                        &output,
                    );
                    if tool_failures.get(&call_id).copied().unwrap_or_default() {
                        if let Some(result) = chunk.result.as_object_mut() {
                            result.insert("success".to_string(), Value::Bool(false));
                            result
                                .insert("status".to_string(), Value::String("failed".to_string()));
                        }
                    }
                    chunks.push(chunk);
                    sequence += 1;
                }
                // `tool_result` blocks were consumed in pass 1.
                _ => {}
            }
        }
    }

    chunks
}

/// Qoder wraps the typed prompt as `<user_query>…</user_query>` behind
/// injected `<system-reminder>` blocks (locale directives etc.). Unwrap to the
/// inner query; when the wrapper is absent, just drop the reminder blocks.
pub(super) fn extract_user_query(text: &str) -> String {
    let trimmed = text.trim();
    if let Some(start) = trimmed.find("<user_query>") {
        let after = &trimmed[start + "<user_query>".len()..];
        let inner = after
            .find("</user_query>")
            .map(|end| &after[..end])
            .unwrap_or(after);
        return inner.trim().to_string();
    }
    strip_system_reminders(trimmed)
}

fn strip_system_reminders(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("<system-reminder>") {
        out.push_str(&rest[..start]);
        match rest[start..].find("</system-reminder>") {
            Some(end) => rest = &rest[start + end + "</system-reminder>".len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

pub(super) fn read_qoder_transcript(path: &Path) -> Result<Vec<QoderTranscriptLine>, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("Failed to open Qoder history {}: {err}", path.display()))?;
    // Tolerate individual malformed lines (e.g. a torn tail write) instead of
    // failing the whole transcript.
    Ok(raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}

/// Content is normally an array of blocks; tolerate anything else as empty.
fn content_blocks(content: &Value) -> Vec<&Value> {
    match content {
        Value::Array(items) => items.iter().collect(),
        _ => Vec::new(),
    }
}

fn block_type(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

fn first_user_text(transcript: &[QoderTranscriptLine]) -> Option<String> {
    for line in transcript {
        if line.role != "user" {
            continue;
        }
        for block in content_blocks(&line.message.content) {
            if block_type(block) == "text" {
                let text =
                    extract_user_query(block.get("text").and_then(Value::as_str).unwrap_or(""));
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
    }
    None
}

/// Flatten a `tool_result.content` value (string, array of blocks, or object)
/// into readable text, capped so a huge output can't bloat the payload.
fn value_to_text(value: Option<&Value>) -> String {
    let mut out = String::new();
    if let Some(value) = value {
        append_value_text(value, &mut out);
    }
    let out = out.trim();
    if out.chars().count() > MAX_TOOL_OUTPUT_CHARS {
        let truncated: String = out.chars().take(MAX_TOOL_OUTPUT_CHARS).collect();
        format!("{truncated}\n… (truncated)")
    } else {
        out.to_string()
    }
}

fn append_value_text(value: &Value, out: &mut String) {
    match value {
        Value::String(text) => push_line(out, text),
        Value::Array(items) => {
            for item in items {
                append_value_text(item, out);
            }
        }
        Value::Object(map) => {
            if let Some(Value::String(text)) = map.get("text") {
                push_line(out, text);
            } else if let Some(Value::String(text)) = map.get("result") {
                push_line(out, text);
            } else {
                push_line(out, &value.to_string());
            }
        }
        Value::Null => {}
        other => push_line(out, &other.to_string()),
    }
}

fn push_line(out: &mut String, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(text);
}
