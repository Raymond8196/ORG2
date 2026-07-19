use std::fs;
use std::path::PathBuf;

use chrono::{Local, NaiveDateTime, TimeZone};
use serde_json::Value;

use super::*;

/// Parse one launch log (agent.log or an exthost output log — the markers are
/// disjoint, so one parser handles both).
pub(super) fn parse_launch_log(content: &str, events: &mut Vec<LogEvent>) {
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(ts_ms) = parse_line_timestamp_ms(line) else {
            continue;
        };
        if let Some(rest) = substring_after(line, ACP_PROGRESS_MARKER) {
            // `<sessionId>, rid=<rid>, type=<type>[, toolCallId=<id>]`
            let mut session_task_id = String::new();
            let mut event_type = "";
            let mut tool_call_id = "";
            for (index, part) in rest.split(", ").enumerate() {
                if index == 0 {
                    session_task_id = part
                        .trim()
                        .trim_end_matches(SESSION_ID_SUFFIX)
                        .to_string();
                } else if let Some(value) = part.trim().strip_prefix("type=") {
                    event_type = value;
                } else if let Some(value) = part.trim().strip_prefix("toolCallId=") {
                    tool_call_id = value;
                }
            }
            if session_task_id.is_empty() {
                continue;
            }
            let tool_call_id = (event_type == "tool_call" && !tool_call_id.is_empty())
                .then(|| tool_call_id.to_string());
            events.push(LogEvent::Acp {
                ts_ms,
                session_task_id,
                tool_call_id,
            });
        } else if let Some(rest) = substring_after(line, SUBAGENT_MARKER) {
            let Ok(payload) = serde_json::from_str::<Value>(rest.trim()) else {
                continue;
            };
            let field = |key: &str| {
                payload
                    .get(key)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            let session_task_id = field("parentSessionId")
                .trim_end_matches(SESSION_ID_SUFFIX)
                .to_string();
            let tool_call_id = field("parentToolCallId");
            if session_task_id.is_empty() || tool_call_id.is_empty() {
                continue;
            }
            events.push(LogEvent::Subagent {
                ts_ms,
                session_task_id,
                tool_call_id,
                agent_type: field("agentType"),
                description: field("rawInputDescription"),
                prompt: field("prompt"),
            });
        } else if let Some(rest) = substring_after(line, TOOL_INVOKE_MARKER) {
            // agent.log: `<rid>, <name>, {args json}` — args may contain
            // ", " so split only the first two fields.
            let Some((_rid, rest)) = rest.split_once(", ") else {
                continue;
            };
            let Some((name, args_raw)) = rest.split_once(", ") else {
                continue;
            };
            push_invoke(events, ts_ms, name, args_raw);
        } else if let Some(rest) = substring_after(line, FILE_CHANGE_MARKER) {
            // `<path> | source=agent | session=<taskDir>, request=<rid> | Agent <op>`
            // (the marker also logs a pipe-less "Agent file tracked:" shape —
            // the parts count filters that out).
            let parts: Vec<&str> = rest.split(" | ").collect();
            if parts.len() < 4 || !parts.contains(&"source=agent") {
                continue;
            }
            let path = parts[0].trim();
            let session_dir_name = parts
                .iter()
                .flat_map(|part| part.split(", "))
                .find_map(|field| field.trim().strip_prefix("session="));
            let operation = parts
                .last()
                .and_then(|part| part.trim().strip_prefix("Agent "))
                .map(str::trim)
                .filter(|op| !op.is_empty());
            let (Some(session_dir_name), Some(operation)) = (session_dir_name, operation) else {
                continue;
            };
            if path.is_empty() {
                continue;
            }
            events.push(LogEvent::FileEdit {
                ts_ms,
                session_dir_name: session_dir_name.to_string(),
                path: path.to_string(),
                operation: operation.to_string(),
            });
        } else if let Some(name) = substring_after(line, EXTHOST_INVOKE_MARKER) {
            // exthost log: `<ts> [info] ToolInvoke : <name>` with the args
            // JSON on the following line.
            let Some(args_line) = lines.peek() else {
                continue;
            };
            if args_line.trim_start().starts_with('{') {
                let args_raw = lines.next().unwrap_or_default();
                push_invoke(events, ts_ms, name, args_raw);
            }
        }
    }
}

fn push_invoke(events: &mut Vec<LogEvent>, ts_ms: i64, name: &str, args_raw: &str) {
    let name = name.trim();
    if name.is_empty() {
        return;
    }
    let args = serde_json::from_str(args_raw.trim()).unwrap_or(Value::Null);
    events.push(LogEvent::ToolInvoke {
        ts_ms,
        name: name.to_string(),
        args,
    });
}

/// Log lines open with `YYYY-MM-DD HH:MM:SS.mmm` in local time.
fn parse_line_timestamp_ms(line: &str) -> Option<i64> {
    let raw = line.get(..23)?;
    let naive = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.3f").ok()?;
    Local
        .from_local_datetime(&naive)
        .single()
        .map(|dt| dt.timestamp_millis())
}

fn substring_after<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    line.find(marker).map(|at| &line[at + marker.len()..])
}

/// Every trajectory-bearing log across launch folders:
/// `<data>/Qoder/logs/<ts>/questWindow/agent.log` and
/// `<data>/Qoder/logs/<ts>/questWindow/exthost/output_logging_*/1-Qoder.log`.
pub(super) fn qoder_launch_log_paths() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(data) = dirs::data_dir() {
        roots.push(data);
    }
    if let Some(config) = dirs::config_dir() {
        roots.push(config);
    }
    roots.sort();
    roots.dedup();

    let mut logs = Vec::new();
    for root in roots {
        let logs_dir = root.join("Qoder").join("logs");
        let Ok(entries) = fs::read_dir(&logs_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let quest_window = entry.path().join("questWindow");
            let agent_log = quest_window.join("agent.log");
            if agent_log.is_file() {
                logs.push(agent_log);
            }
            let exthost = quest_window.join("exthost");
            let Ok(exthost_entries) = fs::read_dir(&exthost) else {
                continue;
            };
            for exthost_entry in exthost_entries.flatten() {
                if !exthost_entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("output_logging")
                {
                    continue;
                }
                let candidate = exthost_entry.path().join("1-Qoder.log");
                if candidate.is_file() {
                    logs.push(candidate);
                }
            }
        }
    }
    logs
}
