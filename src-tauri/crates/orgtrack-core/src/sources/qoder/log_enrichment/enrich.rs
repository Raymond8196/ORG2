use std::collections::HashMap;
use std::fs;
use std::path::Path;

use core_types::activity::ActivityChunk;
use serde_json::{json, Value};

use super::*;

use super::super::history::MAX_TOOL_OUTPUT_CHARS;
use crate::sources::imported_history::{self, ImportedToolCall};

/// Enrich a session's text-only chunks with the tool trajectory recovered
/// from Qoder's launch logs. `task_dir_name`/`project_dir_name` are the
/// conversation-history composite id halves; `workspace_path` is the
/// session's workspace when known (used for exact cwd attribution).
pub(in crate::sources::qoder) fn enrich_with_agent_log(
    session_id: &str,
    task_dir_name: &str,
    project_dir_name: &str,
    workspace_path: Option<&str>,
    chunks: Vec<ActivityChunk>,
) -> Vec<ActivityChunk> {
    let mut events = Vec::new();
    for log_path in qoder_launch_log_paths() {
        if let Ok(content) = fs::read_to_string(&log_path) {
            parse_launch_log(&content, &mut events);
        }
    }
    enrich_chunks_with_events(
        session_id,
        task_dir_name,
        project_dir_name,
        workspace_path,
        chunks,
        &events,
        &edit_snapshots_for_task,
    )
}

pub(super) fn enrich_chunks_with_events(
    session_id: &str,
    task_dir_name: &str,
    project_dir_name: &str,
    workspace_path: Option<&str>,
    chunks: Vec<ActivityChunk>,
    events: &[LogEvent],
    edit_snapshots: &dyn Fn(&str) -> HashMap<String, (String, String)>,
) -> Vec<ActivityChunk> {
    // Resolve the truncated dir name to the full task id seen in the logs.
    // Two distinct matches would mean we cannot tell the sessions apart —
    // back off rather than guess.
    let mut matched_task_id: Option<&str> = None;
    for event in events {
        let candidate = match event {
            LogEvent::Acp {
                session_task_id, ..
            }
            | LogEvent::Subagent {
                session_task_id, ..
            } => session_task_id,
            // Invoke lines carry no id; FileEdit lines carry only the
            // truncated dir name, which cannot disambiguate a prefix clash.
            LogEvent::ToolInvoke { .. } | LogEvent::FileEdit { .. } => continue,
        };
        if !candidate.starts_with(task_dir_name) {
            continue;
        }
        match matched_task_id {
            None => matched_task_id = Some(candidate),
            Some(existing) if existing == candidate => {}
            Some(_) => return chunks,
        }
    }
    let Some(task_id) = matched_task_id else {
        return chunks;
    };

    // Activity window per session, for invoke lines whose paths say nothing.
    let mut windows: HashMap<&str, (i64, i64)> = HashMap::new();
    for event in events {
        if let LogEvent::Acp {
            ts_ms,
            session_task_id,
            ..
        } = event
        {
            windows
                .entry(session_task_id.as_str())
                .and_modify(|(lo, hi)| {
                    *lo = (*lo).min(*ts_ms);
                    *hi = (*hi).max(*ts_ms);
                })
                .or_insert((*ts_ms, *ts_ms));
        }
    }
    let our_window = windows
        .get(task_id)
        .map(|(lo, hi)| (lo - WINDOW_PAD_MS, hi + WINDOW_PAD_MS));
    let other_windows: Vec<(i64, i64)> = windows
        .iter()
        .filter(|(sid, _)| **sid != task_id)
        .map(|(_, (lo, hi))| (lo - WINDOW_PAD_MS, hi + WINDOW_PAD_MS))
        .collect();

    // Our ACP tool_call ids, kept only to pair invokes back to a call id and
    // to anchor subagent cards — never emitted bare (an id alone renders as an
    // empty card).
    let mut our_acp_calls: Vec<(i64, &str)> = events
        .iter()
        .filter_map(|event| match event {
            LogEvent::Acp {
                ts_ms,
                session_task_id,
                tool_call_id: Some(id),
            } if session_task_id == task_id => Some((*ts_ms, id.as_str())),
            _ => None,
        })
        .collect();
    our_acp_calls.sort_by_key(|(ts, _)| *ts);

    #[derive(Debug)]
    struct PendingTool {
        ts_ms: i64,
        call_id: String,
        name: String,
        args: Value,
        output: String,
    }
    let mut pending: Vec<PendingTool> = Vec::new();

    for event in events {
        match event {
            LogEvent::Subagent {
                ts_ms,
                session_task_id,
                tool_call_id,
                agent_type,
                description,
                prompt,
            } if session_task_id == task_id => {
                pending.push(PendingTool {
                    ts_ms: *ts_ms,
                    call_id: tool_call_id.clone(),
                    name: "subagent".to_string(),
                    args: json!({
                        "agentType": agent_type,
                        "description": description,
                        "prompt": prompt,
                    }),
                    output: String::new(),
                });
            }
            LogEvent::ToolInvoke { ts_ms, name, args } => {
                let owned = match invoke_content_signal(args, project_dir_name, workspace_path) {
                    ContentSignal::Ours => true,
                    ContentSignal::Theirs => false,
                    ContentSignal::Silent => {
                        // No path signal: fall back to the activity window,
                        // requiring it to be unambiguous.
                        our_window.is_some_and(|(lo, hi)| *ts_ms >= lo && *ts_ms <= hi)
                            && !other_windows
                                .iter()
                                .any(|(lo, hi)| *ts_ms >= *lo && *ts_ms <= *hi)
                    }
                };
                if !owned {
                    continue;
                }
                let call_id = paired_call_id(&our_acp_calls, *ts_ms)
                    .unwrap_or_else(|| format!("invoke-{ts_ms}"));
                pending.push(PendingTool {
                    ts_ms: *ts_ms,
                    call_id,
                    name: name.clone(),
                    args: args.clone(),
                    output: spill_file_output(args),
                });
            }
            LogEvent::FileEdit {
                ts_ms,
                session_dir_name,
                path,
                operation,
            } if session_dir_name == task_dir_name => {
                // The tracking line carries the session directly, but no
                // content — the card still renders as a typed edit of the
                // file. The diff body is not recoverable from any local store.
                let call_id = paired_call_id(&our_acp_calls, *ts_ms)
                    .unwrap_or_else(|| format!("edit-{ts_ms}"));
                pending.push(PendingTool {
                    ts_ms: *ts_ms,
                    call_id,
                    name: format!("file_{operation}"),
                    args: json!({ "file_path": path, "operation": operation }),
                    output: String::new(),
                });
            }
            _ => {}
        }
    }

    if pending.is_empty() {
        return chunks;
    }
    pending.sort_by_key(|tool| tool.ts_ms);
    // The same invocation can be logged by both the workbench and the exthost;
    // collapse near-simultaneous duplicates.
    pending.dedup_by(|a, b| {
        a.name == b.name && a.args == b.args && (a.ts_ms - b.ts_ms).abs() <= 2_000
    });

    // Attach real diff bodies from the chat-editing snapshot store. The store
    // keeps one original→current pair per file spanning the whole session, so
    // it lands on the file's LAST edit card; earlier edits of the same file
    // stay operation markers.
    if pending.iter().any(|tool| tool.name.starts_with("file_")) {
        let snapshots = edit_snapshots(task_id);
        let mut attached: std::collections::HashSet<String> = std::collections::HashSet::new();
        for tool in pending.iter_mut().rev() {
            if !tool.name.starts_with("file_") {
                continue;
            }
            let Some(path) = tool.args.get("file_path").and_then(Value::as_str) else {
                continue;
            };
            if attached.contains(path) {
                continue;
            }
            if let Some((old_content, new_content)) = snapshots.get(path) {
                attached.insert(path.to_string());
                if let Some(map) = tool.args.as_object_mut() {
                    map.insert("old_string".to_string(), json!(old_content));
                    map.insert("new_string".to_string(), json!(new_content));
                }
            }
        }
    }

    let mut tool_chunks = Vec::with_capacity(pending.len());
    for (index, tool) in pending.iter().enumerate() {
        let call = ImportedToolCall {
            call_id: tool.call_id.clone(),
            raw_name: tool.name.clone(),
            canonical_name: canonical_tool_name(&tool.name),
            args: normalized_args(&tool.name, &tool.args),
            created_at: imported_history::epoch_ms_to_iso(tool.ts_ms),
        };
        let mut chunk = imported_history::tool_call_chunk(
            session_id,
            "qoder-log",
            index,
            &call,
            &tool.output,
        );
        if let Some(result) = chunk.result.as_object_mut() {
            // Flag the provenance so consumers can tell recovered trajectory
            // from the durable transcript.
            result.insert("recovered_from".to_string(), json!("agent_log"));
        }
        tool_chunks.push(chunk);
    }

    // Insert after the last user message: quests are single-user-turn in the
    // normal case, and the recovered activity belongs to the agent's work
    // phase that follows it. Multi-turn sessions get the whole trajectory in
    // the final turn — a documented best-effort placement.
    let insert_at = chunks
        .iter()
        .rposition(|chunk| chunk.function == imported_history::FUNCTION_USER_MESSAGE)
        .map(|position| position + 1)
        .unwrap_or(0);
    let mut enriched = chunks;
    enriched.splice(insert_at..insert_at, tool_chunks);
    enriched
}

/// Judge which session an invoke belongs to from the paths in its args.
/// `file_path` under a project cache dir or `cwd` inside the workspace are
/// decisive; paths that name a *different* project cache dir disown it.
fn invoke_content_signal(
    args: &Value,
    project_dir_name: &str,
    workspace_path: Option<&str>,
) -> ContentSignal {
    let candidates = ["file_path", "cwd", "path"]
        .iter()
        .filter_map(|key| args.get(*key).and_then(Value::as_str));
    let our_cache_dir = format!("/cache/projects/{project_dir_name}/");
    let mut signal = ContentSignal::Silent;
    for path in candidates {
        if path.contains(&our_cache_dir) {
            return ContentSignal::Ours;
        }
        if let Some(workspace) = workspace_path {
            let workspace = workspace.trim_end_matches('/');
            if !workspace.is_empty()
                && (path == workspace || path.starts_with(&format!("{workspace}/")))
            {
                return ContentSignal::Ours;
            }
        }
        if path.contains("/cache/projects/") {
            signal = ContentSignal::Theirs;
        }
    }
    signal
}

/// Most recent ACP `tool_call` id preceding `ts_ms` within the pairing window.
fn paired_call_id(our_acp_calls: &[(i64, &str)], ts_ms: i64) -> Option<String> {
    our_acp_calls
        .iter()
        .rev()
        .find(|(acp_ts, _)| *acp_ts <= ts_ms && ts_ms - acp_ts <= CALL_ID_PAIR_MS)
        .map(|(_, id)| (*id).to_string())
}

/// Map Qoder tool names onto the canonical functions the replay UI has typed
/// cards for; unknown names pass through as generic cards.
fn canonical_tool_name(name: &str) -> String {
    match name {
        "read_file" => imported_history::FUNCTION_READ_FILE.to_string(),
        "run_in_terminal" => imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
        // Qoder's diagnostics probe ↔ ORGII's LSP query card.
        "get_problems" => "query_lsp".to_string(),
        // Our own synthesis of FileChangeTracking ops (file_create, file_edit, …).
        name if name.starts_with("file_") => imported_history::FUNCTION_EDIT_FILE.to_string(),
        other => other.to_string(),
    }
}

/// Reshape args into the keys the frontend extractors read.
fn normalized_args(name: &str, args: &Value) -> Value {
    if name == "run_in_terminal" {
        if let Some(command) = args.get("command") {
            let mut merged = args.clone();
            if let Some(map) = merged.as_object_mut() {
                map.insert("cmd".to_string(), command.clone());
            }
            return merged;
        }
    }
    if name == "get_problems" {
        // `{"filePaths": [...], "file_paths": [...]}` → surface the first
        // path under the key the file extractors read.
        let first_path = ["filePaths", "file_paths"]
            .iter()
            .filter_map(|key| args.get(*key).and_then(Value::as_array))
            .flat_map(|paths| paths.iter())
            .find_map(Value::as_str);
        if let Some(path) = first_path {
            let mut merged = args.clone();
            if let Some(map) = merged.as_object_mut() {
                map.insert("file_path".to_string(), json!(path));
            }
            return merged;
        }
    }
    args.clone()
}

/// When a `read_file` targets an `agent-tools` spill file, its content is the
/// missing tool OUTPUT — attach it (capped). Other paths are live workspace
/// files that may have changed since; leave those empty.
fn spill_file_output(args: &Value) -> String {
    let Some(path) = args.get("file_path").and_then(Value::as_str) else {
        return String::new();
    };
    if !path.contains("/agent-tools/") {
        return String::new();
    }
    let Ok(content) = fs::read_to_string(Path::new(path)) else {
        return String::new();
    };
    if content.chars().count() > MAX_TOOL_OUTPUT_CHARS {
        let truncated: String = content.chars().take(MAX_TOOL_OUTPUT_CHARS).collect();
        format!("{truncated}\n… (truncated)")
    } else {
        content.trim_end().to_string()
    }
}
