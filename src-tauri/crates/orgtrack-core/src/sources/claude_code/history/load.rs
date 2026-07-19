//! Transcript → `ActivityChunk` loader plus the Claude tool-call/content
//! normalization helpers used both here and by the metadata parser.

use super::*;

pub(super) fn load_claude_code_history_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<ActivityChunk>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))?;
    let reader = BufReader::new(file);

    let mut chunks = Vec::new();
    let mut pending_tool_calls: HashMap<String, ImportedToolCall> = HashMap::new();
    let mut sequence = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Claude history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: ClaudeJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let created_at = parsed
            .timestamp
            .as_deref()
            .map(imported_history::normalize_created_at)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let Some(message) = parsed.message else {
            continue;
        };

        match parsed.r#type.as_str() {
            "user" => {
                if let Some(tool_result_output) = claude_tool_result_text(&message.content) {
                    if let Some((call_id, output)) = tool_result_output {
                        if let Some(call) = pending_tool_calls.remove(&call_id) {
                            let mut chunk = imported_history::tool_call_chunk(
                                session_id,
                                CLAUDE_CODE_PROVIDER_SLUG,
                                sequence,
                                &call,
                                &output,
                            );
                            // Edit/MultiEdit/Write results carry a
                            // `structuredPatch`; attach it as the exact diff so
                            // the edit card renders the real change.
                            apply_claude_edit_diff(&mut chunk, parsed.tool_use_result.as_ref());
                            chunks.push(chunk);
                            sequence += 1;
                        }
                    }
                } else if let Some(text) = claude_content_text(&message.content) {
                    // Strip the GUI exec-mode briefing; a bridge-only message
                    // carries no user-authored text, so emit no bubble.
                    let text = imported_history::strip_orgii_exec_mode_bridge(&text);
                    if !text.trim().is_empty() {
                        chunks.push(imported_history::user_message_chunk(
                            session_id,
                            CLAUDE_CODE_PROVIDER_SLUG,
                            sequence,
                            &created_at,
                            text,
                        ));
                        sequence += 1;
                    }
                }
            }
            "assistant" => {
                for item in claude_content_items(&message.content) {
                    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                    match item_type {
                        "text" => {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                chunks.push(imported_history::assistant_message_chunk(
                                    session_id,
                                    CLAUDE_CODE_PROVIDER_SLUG,
                                    sequence,
                                    &created_at,
                                    text,
                                ));
                                sequence += 1;
                            }
                        }
                        "thinking" => {
                            if let Some(text) = item.get("thinking").and_then(Value::as_str) {
                                chunks.push(imported_history::thinking_chunk(
                                    session_id,
                                    CLAUDE_CODE_PROVIDER_SLUG,
                                    sequence,
                                    &created_at,
                                    text,
                                ));
                                sequence += 1;
                            }
                        }
                        "tool_use" => {
                            if let Some(call) = claude_tool_call_from_item(item, &created_at) {
                                pending_tool_calls.insert(call.call_id.clone(), call);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    for call in pending_tool_calls.into_values() {
        chunks.push(imported_history::tool_call_chunk(
            session_id,
            CLAUDE_CODE_PROVIDER_SLUG,
            sequence,
            &call,
            "",
        ));
        sequence += 1;
    }

    Ok(chunks)
}

fn claude_tool_call_from_item(item: &Value, created_at: &str) -> Option<ImportedToolCall> {
    let call_id = item.get("id")?.as_str()?.to_string();
    let raw_name = item.get("name")?.as_str()?.to_string();
    let args = item.get("input").cloned().unwrap_or_else(|| json!({}));
    let (canonical_name, args) = normalize_claude_tool_call(&raw_name, args);
    Some(ImportedToolCall {
        call_id,
        raw_name,
        canonical_name,
        args,
        created_at: created_at.to_string(),
    })
}

fn normalize_claude_tool_call(raw_name: &str, args: Value) -> (String, Value) {
    match raw_name {
        "Bash" => (
            imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
            normalize_shell_args(args),
        ),
        "Edit" | "MultiEdit" | "Write" => (
            imported_history::FUNCTION_EDIT_FILE.to_string(),
            normalize_edit_args(raw_name, args),
        ),
        _ => (raw_name.to_string(), args),
    }
}

fn normalize_shell_args(args: Value) -> Value {
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .or_else(|| args.get("cmd").and_then(Value::as_str))
        .unwrap_or_default();
    json!({
        "command": command,
        "cmd": command,
    })
}

fn normalize_edit_args(raw_name: &str, args: Value) -> Value {
    let file_path = args
        .get("file_path")
        .and_then(Value::as_str)
        .or_else(|| args.get("path").and_then(Value::as_str))
        .unwrap_or_default();
    // `create` for new-file Writes (so the diff card can tag it as new), `edit`
    // otherwise. Old/new text is intentionally NOT carried on the args: the exact
    // diff is threaded onto the result from the tool's `structuredPatch` at
    // result-pairing time (see `apply_claude_edit_diff`), and keeping old/new off
    // the args lets the frontend render that context-rich diff rather than a bare
    // old_string→new_string snippet.
    let action = if raw_name == "Write" {
        "create"
    } else {
        "edit"
    };
    json!({
        "action": action,
        "file_path": file_path,
    })
}

/// Attach the exact edit diff to a tool-result chunk.
///
/// Edit/MultiEdit/Write results carry a `toolUseResult.structuredPatch`; convert
/// it to a unified diff (with surrounding context) and store it on the chunk
/// result as `diff` plus exact `linesAdded`/`linesRemoved`, so the frontend diff
/// card renders the real change. When no patch is present (rare/older
/// transcripts) fall back to the authoritative `oldString`/`newString` (or a
/// Write's `content`) so at least a snippet still renders.
fn apply_claude_edit_diff(chunk: &mut ActivityChunk, tool_use_result: Option<&Value>) {
    let Some(result) = tool_use_result else {
        return;
    };

    if let Some((diff, added, removed)) = claude_unified_diff_from_patch(result) {
        if let Some(obj) = chunk.result.as_object_mut() {
            obj.insert("diff".to_string(), Value::String(diff));
            obj.insert("linesAdded".to_string(), json!(added));
            obj.insert("linesRemoved".to_string(), json!(removed));
        }
        return;
    }

    let old_string = result
        .get("oldString")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let new_string = result
        .get("newString")
        .or_else(|| result.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if old_string.is_empty() && new_string.is_empty() {
        return;
    }
    if let Some(obj) = chunk.args.as_object_mut() {
        obj.insert("old_string".to_string(), json!(old_string));
        obj.insert("new_string".to_string(), json!(new_string));
    }
}

/// Convert a `toolUseResult.structuredPatch` into a unified diff string plus its
/// added/removed line counts. Returns `None` when no (non-empty) patch is present.
///
/// Each hunk's `lines` are already prefixed with `+`/`-`/` `, so this yields a
/// standard unified diff that the frontend diff extractor parses directly.
fn claude_unified_diff_from_patch(result: &Value) -> Option<(String, i64, i64)> {
    let hunks = result.get("structuredPatch").and_then(Value::as_array)?;
    if hunks.is_empty() {
        return None;
    }
    let path = result.get("filePath").and_then(Value::as_str).unwrap_or("");
    let mut diff = format!("--- {path}\n+++ {path}\n");
    let mut added = 0i64;
    let mut removed = 0i64;
    for hunk in hunks {
        let old_start = hunk.get("oldStart").and_then(Value::as_i64).unwrap_or(0);
        let old_lines = hunk.get("oldLines").and_then(Value::as_i64).unwrap_or(0);
        let new_start = hunk.get("newStart").and_then(Value::as_i64).unwrap_or(0);
        let new_lines = hunk.get("newLines").and_then(Value::as_i64).unwrap_or(0);
        diff.push_str(&format!(
            "@@ -{old_start},{old_lines} +{new_start},{new_lines} @@\n"
        ));
        let Some(lines) = hunk.get("lines").and_then(Value::as_array) else {
            continue;
        };
        for line in lines {
            let Some(text) = line.as_str() else {
                continue;
            };
            match text.as_bytes().first() {
                Some(b'+') => added += 1,
                Some(b'-') => removed += 1,
                _ => {}
            }
            diff.push_str(text);
            diff.push('\n');
        }
    }
    Some((diff, added, removed))
}

pub(super) fn claude_content_items(content: &Value) -> Vec<&Value> {
    match content {
        Value::Array(items) => items.iter().collect(),
        _ => Vec::new(),
    }
}

pub(super) fn claude_content_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn claude_tool_result_text(content: &Value) -> Option<Option<(String, String)>> {
    let Value::Array(items) = content else {
        return None;
    };
    let result_item = items
        .iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("tool_result"))?;
    let call_id = result_item.get("tool_use_id")?.as_str()?.to_string();
    let output = match result_item.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    Some(Some((call_id, output)))
}
