//! Cline imported-history reader
//!
//! Reads the Cline CLI's local per-session store under
//! `~/.cline/data/sessions/<id>/` and converts each transcript into ORGII's
//! canonical `ActivityChunk` shape for read-only replay. The transcript is an
//! Anthropic-style `messages` array, so tool calls and their results are paired
//! back together (a `tool_use` in an assistant turn with the matching
//! `tool_result` from the following user turn).
//!
//! Cline batches several operations into one tool call (`run_commands`,
//! `read_files`, `search_codebase` each take a list and return a parallel result
//! list). Each call is expanded into one canonical single-op chunk per operation
//! so it renders as its own typed card; see [`expand_cline_tool_call`].

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use core_types::activity::ActivityChunk;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::sources::imported_history::{
    self, cache as imported_cache,
    metadata::{
        ImportedHistoryCacheInput, ImportedHistoryDiscoveredRecord, ImportedHistoryImpactStats,
        SOURCE_CLINE,
    },
    paths as imported_paths, ImportedHistoryRecentPath, ImportedHistorySessionPage,
    ImportedHistorySessionRow, ImportedToolCall,
};

const CLINE_SESSION_PREFIX: &str = "clineapp-";
const CLINE_PROVIDER_SLUG: &str = "cline";
const CLINE_METADATA_PARSER_VERSION: i64 = 1;
const MESSAGES_SUFFIX: &str = ".messages.json";
/// Cap a single tool-result body so a runaway command output can't bloat the
/// cache/replay payload. The replay UI virtualizes long text anyway.
const MAX_TOOL_OUTPUT_CHARS: usize = 50_000;

pub type ClineHistorySessionRow = ImportedHistorySessionRow;
pub type ClineHistorySessionPage = ImportedHistorySessionPage;
pub type ClineRecentPath = ImportedHistoryRecentPath;

#[derive(Debug, Clone)]
struct ClineHistoryMeta {
    source_session_id: String,
    session_id: String,
    source_path: String,
    source_record_key: String,
    source_mtime_ms: i64,
    source_size_bytes: i64,
    name: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    model: Option<String>,
    repo_path: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
}

/// `<id>.json` — session metadata sidecar.
#[derive(Debug, Default, Deserialize)]
struct ClineSessionJson {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    workspace_root: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    metadata: Option<ClineSessionMetadata>,
}

#[derive(Debug, Default, Deserialize)]
struct ClineSessionMetadata {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    usage: Option<ClineUsage>,
}

#[derive(Debug, Default, Deserialize)]
struct ClineUsage {
    #[serde(default, rename = "inputTokens")]
    input_tokens: Option<i64>,
    #[serde(default, rename = "outputTokens")]
    output_tokens: Option<i64>,
}

/// `<id>.messages.json` — the transcript.
#[derive(Debug, Default, Deserialize)]
struct ClineTranscript {
    #[serde(default)]
    messages: Vec<ClineMessage>,
}

#[derive(Debug, Default, Deserialize)]
struct ClineMessage {
    #[serde(default)]
    role: String,
    #[serde(default)]
    content: Value,
    #[serde(default)]
    ts: Option<i64>,
}

pub fn list_cline_history_sessions_paginated(
    conn: &mut Connection,
    limit: usize,
    offset: usize,
) -> Result<ClineHistorySessionPage, String> {
    sync_cline_history_cache(conn)?;
    imported_cache::query_imported_session_page_from_conn(conn, SOURCE_CLINE, limit, offset)
}

pub fn list_cline_recent_paths(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<ClineRecentPath>, String> {
    sync_cline_history_cache(conn)?;
    imported_cache::query_imported_recent_paths_from_conn(conn, SOURCE_CLINE, limit)
}

pub fn load_cline_history_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let source_session_id = cline_source_id_from_session_id(session_id)?;
    let path = resolve_cline_messages_path(conn, source_session_id)?;
    load_cline_history_from_path(session_id, &path)
}

fn sync_cline_history_cache(conn: &mut Connection) -> Result<(), String> {
    let discovered = discover_cline_history_records()?;
    let signatures = discovered
        .iter()
        .map(ImportedHistoryDiscoveredRecord::signature)
        .collect::<Vec<_>>();
    let changed =
        imported_cache::changed_records_from_conn(conn, SOURCE_CLINE, &discovered, |record| {
            record.signature()
        })?;
    let mut inputs = Vec::new();
    for record in changed {
        if let Some(meta) = parse_cline_session_meta(record)? {
            inputs.push(session_meta_to_cache_input(meta));
        }
    }
    imported_cache::sync_source_cache_from_conn(
        conn,
        SOURCE_CLINE,
        imported_cache::live_ids_from_signatures(&signatures),
        inputs,
    )
}

fn discover_cline_history_records() -> Result<Vec<ImportedHistoryDiscoveredRecord>, String> {
    let mut records = Vec::new();
    for sessions_dir in cline_sessions_dirs()? {
        if !sessions_dir.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&sessions_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Some(id) = dir.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let messages_path = dir.join(format!("{id}{MESSAGES_SUFFIX}"));
            if !messages_path.is_file() {
                continue;
            }
            let (source_mtime_ms, source_size_bytes) =
                imported_paths::file_metadata_signature(&messages_path, "Cline")?;
            records.push(ImportedHistoryDiscoveredRecord {
                source_session_id: id.to_string(),
                source_path: messages_path,
                source_record_key: id.to_string(),
                source_mtime_ms,
                source_size_bytes,
                source_fingerprint: String::new(),
                parser_version: CLINE_METADATA_PARSER_VERSION,
            });
        }
    }
    Ok(records)
}

fn parse_cline_session_meta(
    record: &ImportedHistoryDiscoveredRecord,
) -> Result<Option<ClineHistoryMeta>, String> {
    let messages_path = &record.source_path;
    let sidecar = sidecar_json_path(messages_path, &record.source_session_id);
    let session_json: ClineSessionJson = sidecar
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();

    let transcript = read_transcript(messages_path).unwrap_or_default();

    let created_at_ms = session_json
        .started_at
        .as_deref()
        .and_then(imported_history::parse_iso_to_epoch_ms_opt)
        .or_else(|| transcript.messages.iter().find_map(|m| m.ts))
        .filter(|ms| *ms > 0)
        .unwrap_or(record.source_mtime_ms);

    let updated_at_ms = transcript
        .messages
        .iter()
        .rev()
        .find_map(|m| m.ts)
        .filter(|ms| *ms > 0)
        .unwrap_or(record.source_mtime_ms);

    let title = session_json
        .metadata
        .as_ref()
        .and_then(|meta| meta.title.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let name = title
        .or_else(|| {
            session_json
                .prompt
                .as_deref()
                .map(strip_user_input_wrapper)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .or_else(|| first_user_text(&transcript))
        .map(|value| imported_history::truncate_name(&value, 200))
        .unwrap_or_else(|| record.source_record_key.clone());

    let repo_path = session_json
        .workspace_root
        .as_deref()
        .or(session_json.cwd.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let model = session_json
        .model
        .as_deref()
        .or(session_json.provider.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let usage = session_json
        .metadata
        .as_ref()
        .and_then(|m| m.usage.as_ref());
    let input_tokens = usage.and_then(|u| u.input_tokens).unwrap_or(0);
    let output_tokens = usage.and_then(|u| u.output_tokens).unwrap_or(0);

    Ok(Some(ClineHistoryMeta {
        source_session_id: record.source_session_id.clone(),
        session_id: format!("{CLINE_SESSION_PREFIX}{}", record.source_session_id),
        source_path: messages_path.to_string_lossy().to_string(),
        source_record_key: record.source_record_key.clone(),
        source_mtime_ms: record.source_mtime_ms,
        source_size_bytes: record.source_size_bytes,
        name,
        created_at_ms,
        updated_at_ms,
        model,
        repo_path,
        input_tokens,
        output_tokens,
    }))
}

fn session_meta_to_cache_input(meta: ClineHistoryMeta) -> ImportedHistoryCacheInput {
    ImportedHistoryCacheInput {
        source: SOURCE_CLINE,
        source_session_id: meta.source_session_id,
        session_id: meta.session_id,
        source_path: meta.source_path,
        source_record_key: meta.source_record_key,
        source_mtime_ms: meta.source_mtime_ms,
        source_size_bytes: meta.source_size_bytes,
        source_fingerprint: String::new(),
        parser_version: CLINE_METADATA_PARSER_VERSION,
        name: meta.name,
        created_at_ms: meta.created_at_ms,
        updated_at_ms: meta.updated_at_ms,
        model: meta.model,
        input_tokens: meta.input_tokens,
        output_tokens: meta.output_tokens,
        repo_path: meta.repo_path,
        branch: None,
        impact: ImportedHistoryImpactStats::default(),
        listable: true,
        source_metadata_json: None,
        parent_session_id: None,
    }
}

fn load_cline_history_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<ActivityChunk>, String> {
    let transcript = read_transcript(path)?;
    Ok(transcript_to_chunks(session_id, &transcript))
}

fn transcript_to_chunks(session_id: &str, transcript: &ClineTranscript) -> Vec<ActivityChunk> {
    // Pass 1: collect every tool result as its raw `content` value (not flattened
    // text) so a batched call can pair each sub-operation with its own entry in
    // the parallel result list, regardless of which later user turn carried it.
    let mut tool_outputs: HashMap<String, Value> = HashMap::new();
    for message in &transcript.messages {
        for block in content_blocks(&message.content) {
            if block_type(block) == "tool_result" {
                if let Some(id) = block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                {
                    tool_outputs.insert(
                        id.to_string(),
                        block.get("content").cloned().unwrap_or(Value::Null),
                    );
                }
            }
        }
    }

    // Pass 2: emit chunks in transcript order.
    let mut chunks = Vec::new();
    let mut sequence = 0usize;
    for message in &transcript.messages {
        let created_at = message
            .ts
            .filter(|ms| *ms > 0)
            .map(imported_history::epoch_ms_to_iso)
            .unwrap_or_default();
        let is_user = message.role == "user";

        for block in content_blocks(&message.content) {
            match block_type(block) {
                "text" => {
                    let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                    let text = if is_user {
                        strip_user_input_wrapper(text)
                    } else {
                        text.trim()
                    };
                    if text.is_empty() {
                        continue;
                    }
                    if is_user {
                        chunks.push(imported_history::user_message_chunk(
                            session_id,
                            CLINE_PROVIDER_SLUG,
                            sequence,
                            &created_at,
                            text,
                        ));
                    } else {
                        chunks.push(imported_history::assistant_message_chunk(
                            session_id,
                            CLINE_PROVIDER_SLUG,
                            sequence,
                            &created_at,
                            text,
                        ));
                    }
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
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    let results = tool_outputs.get(&call_id);

                    // One Cline tool call can carry several operations; expand it
                    // into one canonical chunk per operation so each renders as
                    // its own typed card (read/shell/search/diff) instead of a
                    // single generic row.
                    let (sub_calls, batched) = expand_cline_tool_call(&raw_name, &input);
                    for (index, (canonical_name, args)) in sub_calls.into_iter().enumerate() {
                        let mut output = cline_sub_output(results, index, batched);
                        if raw_name == "read_files" {
                            output = strip_cline_read_gutter(&output);
                        }
                        let call = ImportedToolCall {
                            call_id: format!("{call_id}#{index}"),
                            raw_name: raw_name.clone(),
                            canonical_name,
                            args,
                            created_at: created_at.clone(),
                        };
                        chunks.push(imported_history::tool_call_chunk(
                            session_id,
                            CLINE_PROVIDER_SLUG,
                            sequence,
                            &call,
                            &output,
                        ));
                        sequence += 1;
                    }
                }
                // `tool_result` blocks were consumed in pass 1.
                _ => {}
            }
        }
    }

    chunks
}

/// Cline packs several operations into one tool call (`commands[]`, `files[]`,
/// `queries[]`) and returns a parallel result list. Expand each batched call
/// into canonical single-op `(function, args)` pairs, reshaping args into the
/// keys the frontend extractors read (`command`, `file_path`, `query`,
/// `old_string`/`new_string`). The returned `bool` is `true` when outputs must
/// be paired with the result list **by index**.
///
/// Unknown or non-batched tools (`ask_question`, `fetch_web_content`, `team_*`,
/// …) fall through to a single passthrough call so nothing is dropped.
fn expand_cline_tool_call(name: &str, input: &Value) -> (Vec<(String, Value)>, bool) {
    let sub_calls: Vec<(String, Value)> = match name {
        "run_commands" => input_array(input, "commands")
            .into_iter()
            .map(|command| {
                let command = command.clone();
                (
                    imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
                    json!({ "command": command.clone(), "cmd": command }),
                )
            })
            .collect(),
        "read_files" => input_array(input, "files")
            .into_iter()
            .map(|file| {
                (
                    imported_history::FUNCTION_READ_FILE.to_string(),
                    json!({ "file_path": file.get("path").cloned().unwrap_or(Value::Null) }),
                )
            })
            .collect(),
        "search_codebase" => input_array(input, "queries")
            .into_iter()
            .map(|query| {
                (
                    imported_history::FUNCTION_CODE_SEARCH.to_string(),
                    json!({ "query": query.clone() }),
                )
            })
            .collect(),
        // `editor` is a single-op edit; reshape to the canonical diff args.
        // `old_text` is null when creating a file or inserting via `insert_line`.
        "editor" => {
            return (
                vec![(
                    imported_history::FUNCTION_EDIT_FILE.to_string(),
                    json!({
                        "file_path": input.get("path").cloned().unwrap_or(Value::Null),
                        "old_string": input
                            .get("old_text")
                            .cloned()
                            .filter(|value| !value.is_null())
                            .unwrap_or_else(|| json!("")),
                        "new_string": input.get("new_text").cloned().unwrap_or_else(|| json!("")),
                    }),
                )],
                false,
            );
        }
        _ => Vec::new(),
    };

    if sub_calls.is_empty() {
        return (vec![(name.to_string(), input.clone())], false);
    }
    (sub_calls, true)
}

/// Borrow the array under `key`, or an empty slice when it is missing/not an array.
fn input_array<'a>(input: &'a Value, key: &str) -> Vec<&'a Value> {
    input
        .get(key)
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

/// Output text for the `index`-th sub-operation. Batched calls index into the
/// result list and take that entry's `result` field (falling back to the whole
/// entry); non-batched calls flatten the entire result.
fn cline_sub_output(results: Option<&Value>, index: usize, batched: bool) -> String {
    if batched {
        if let Some(Value::Array(items)) = results {
            if let Some(item) = items.get(index) {
                return value_to_text(item.get("result").or(Some(item)));
            }
        }
        return String::new();
    }
    value_to_text(results)
}

/// Strip Cline's `<n> | ` read-file gutter so the read card shows clean file
/// content (the code viewer renders its own line numbers). Only strips when the
/// first non-empty line is gutter-prefixed, so command output that merely
/// contains a `|` is left untouched.
fn strip_cline_read_gutter(text: &str) -> String {
    let looks_gutter = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .and_then(gutter_body)
        .is_some();
    if !looks_gutter {
        return text.to_string();
    }
    text.lines()
        .map(|line| gutter_body(line).unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Return the content of a ` <n> | text` gutter line (here `text`), or `None`
/// when the line is not gutter-prefixed.
fn gutter_body(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let digits_end = trimmed.find(|c: char| !c.is_ascii_digit())?;
    if digits_end == 0 {
        return None;
    }
    let after_digits = &trimmed[digits_end..];
    let rest = after_digits.strip_prefix(' ').unwrap_or(after_digits);
    let rest = rest.strip_prefix('|')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

fn read_transcript(path: &Path) -> Result<ClineTranscript, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("Failed to open Cline history {}: {err}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse Cline history {}: {err}", path.display()))
}

/// Content is normally an array of blocks; tolerate a bare string too.
fn content_blocks(content: &Value) -> Vec<&Value> {
    match content {
        Value::Array(items) => items.iter().collect(),
        _ => Vec::new(),
    }
}

fn block_type(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

fn first_user_text(transcript: &ClineTranscript) -> Option<String> {
    for message in &transcript.messages {
        if message.role != "user" {
            continue;
        }
        for block in content_blocks(&message.content) {
            if block_type(block) == "text" {
                let text = strip_user_input_wrapper(
                    block.get("text").and_then(Value::as_str).unwrap_or(""),
                );
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }
    None
}

/// Cline wraps user prompts as `<user_input mode="act">…</user_input>`; unwrap to
/// the inner text for a clean title/replay. Leaves non-wrapped text untouched.
fn strip_user_input_wrapper(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(after_open) = trimmed.strip_prefix("<user_input") else {
        return trimmed;
    };
    let Some(gt) = after_open.find('>') else {
        return trimmed;
    };
    let inner = &after_open[gt + 1..];
    inner.strip_suffix("</user_input>").unwrap_or(inner).trim()
}

/// Flatten a `tool_result.content` value (string, array of blocks, or object)
/// into readable text, capped so a huge command output can't bloat the payload.
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

fn sidecar_json_path(messages_path: &Path, source_session_id: &str) -> Option<PathBuf> {
    let parent = messages_path.parent()?;
    let candidate = parent.join(format!("{source_session_id}.json"));
    candidate.is_file().then_some(candidate)
}

fn cline_source_id_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(rest) = session_id.strip_prefix(CLINE_SESSION_PREFIX) else {
        return Err(format!("Invalid Cline history session id: {session_id}"));
    };
    if rest.is_empty() {
        return Err("Cline history session id is missing its source id".to_string());
    }
    Ok(rest)
}

fn resolve_cline_messages_path(
    conn: &Connection,
    source_session_id: &str,
) -> Result<PathBuf, String> {
    if let Some(path) =
        imported_cache::get_cached_source_path_from_conn(conn, SOURCE_CLINE, source_session_id)?
    {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    for sessions_dir in cline_sessions_dirs()? {
        let candidate = sessions_dir
            .join(source_session_id)
            .join(format!("{source_session_id}{MESSAGES_SUFFIX}"));
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "Cline history file not found for session: {source_session_id}"
    ))
}

fn cline_sessions_dirs() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    Ok(cline_sessions_dir_candidates(&home))
}

/// `~/.cline/data/sessions` — the CLI's per-session store root.
fn cline_sessions_dir_candidates(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".cline").join("data").join("sessions")]
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
