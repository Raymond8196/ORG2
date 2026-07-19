use serde_json::{json, Value};

use crate::sources::imported_history;

use super::*;

pub(crate) fn normalize_codex_tool_calls(raw_name: &str, args: Value) -> Vec<(String, Value)> {
    let key = normalize_tool_name_key(raw_name);
    match key.as_str() {
        key if is_codex_shell_tool_key(key) => {
            let shell_args = normalize_shell_args(args);
            if let Some(read_args) = read_file_arg_values_from_shell_args(&shell_args) {
                read_args
                    .into_iter()
                    .map(|args| (imported_history::FUNCTION_READ_FILE.to_string(), args))
                    .collect()
            } else if let Some(calls) = exploration_tool_calls_from_shell_args(&shell_args) {
                calls
            } else {
                vec![(
                    imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
                    shell_args,
                )]
            }
        }
        "rg" | "ripgrep" | "grep" | "search" | "code_search" | "search_code"
        | "search_codebase" => vec![(
            imported_history::FUNCTION_CODE_SEARCH.to_string(),
            normalize_search_args(args),
        )],
        "web__run" | "web_run" | "web_search" => {
            vec![("web_search".to_string(), normalize_web_search_args(args))]
        }
        "write_stdin" => vec![(
            imported_history::FUNCTION_AWAIT_OUTPUT.to_string(),
            normalize_write_stdin_args(args),
        )],
        "cat" | "sed" | "head" | "tail" => {
            let shell_args = normalize_shell_args(args);
            if let Some(read_args) = read_file_args_from_shell_args(&shell_args) {
                vec![(imported_history::FUNCTION_READ_FILE.to_string(), read_args)]
            } else {
                vec![(
                    imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
                    shell_args,
                )]
            }
        }
        "apply_patch" => vec![(
            imported_history::FUNCTION_EDIT_FILE.to_string(),
            normalize_apply_patch_args(args),
        )],
        "edit" | "edit_file" | "write" | "write_file" | "create_file" => vec![(
            imported_history::FUNCTION_EDIT_FILE.to_string(),
            normalize_edit_args(raw_name, args),
        )],
        _ => vec![(raw_name.to_string(), args)],
    }
}

pub(crate) fn is_codex_shell_tool_key(key: &str) -> bool {
    matches!(
        key,
        "shell"
            | "shell_command"
            | "exec_command"
            | "bash"
            | "terminal"
            | "terminal_command"
            | "run_shell"
            | "run_command"
            | "execute"
            | "exec"
    )
}

pub(crate) fn normalize_shell_args(args: Value) -> Value {
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .or_else(|| args.get("cmd").and_then(Value::as_str))
        .or_else(|| args.get("input").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let cwd = args
        .get("cwd")
        .and_then(Value::as_str)
        .or_else(|| args.get("workdir").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    json!({
        "command": command.clone(),
        "cmd": command,
        "cwd": cwd.clone(),
        "workdir": cwd,
        "payload": args,
    })
}

pub(crate) fn normalize_write_stdin_args(args: Value) -> Value {
    let session_id = args
        .get("session_id")
        .or_else(|| args.get("sessionId"))
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
        .unwrap_or_default();
    let chars = args
        .get("chars")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let block_until_ms = args
        .get("yield_time_ms")
        .or_else(|| args.get("yield_time"))
        .and_then(Value::as_i64)
        .unwrap_or_default();
    json!({
        "command": "wait_for",
        "handle": session_id.clone(),
        "handles": [session_id.clone()],
        "session_id": session_id,
        "chars": chars,
        "block_until_ms": block_until_ms,
        "payload": args,
    })
}

pub(crate) fn normalize_apply_patch_args(args: Value) -> Value {
    let patch = args
        .get("patch")
        .and_then(Value::as_str)
        .or_else(|| args.get("patch_text").and_then(Value::as_str))
        .or_else(|| args.get("input").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let file_path = first_apply_patch_file_path(&patch).unwrap_or_default();
    json!({
        "action": "apply_patch",
        "patch": patch.clone(),
        "patch_text": patch,
        "file_path": file_path.clone(),
        "target_file": file_path,
        "payload": args,
    })
}

pub(crate) fn normalize_edit_args(raw_name: &str, args: Value) -> Value {
    if args
        .get("patch")
        .and_then(Value::as_str)
        .or_else(|| args.get("patch_text").and_then(Value::as_str))
        .is_some()
    {
        return normalize_apply_patch_args(args);
    }

    let file_path = args
        .get("file_path")
        .and_then(Value::as_str)
        .or_else(|| args.get("path").and_then(Value::as_str))
        .or_else(|| args.get("target_file").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let old_content = args
        .get("old_content")
        .and_then(Value::as_str)
        .or_else(|| args.get("old_str").and_then(Value::as_str))
        .or_else(|| args.get("old_string").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let new_content = args
        .get("new_content")
        .and_then(Value::as_str)
        .or_else(|| args.get("new_str").and_then(Value::as_str))
        .or_else(|| args.get("new_string").and_then(Value::as_str))
        .or_else(|| args.get("content").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();

    json!({
        "action": raw_name,
        "file_path": file_path.clone(),
        "target_file": file_path,
        "old_content": old_content.clone(),
        "new_content": new_content.clone(),
        "content": new_content,
        "payload": args,
    })
}

pub(crate) fn normalize_search_args(args: Value) -> Value {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .or_else(|| args.get("pattern").and_then(Value::as_str))
        .or_else(|| args.get("search_query").and_then(Value::as_str))
        .or_else(|| args.get("regex").and_then(Value::as_str))
        .or_else(|| args.get("input").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    json!({
        "action": "grep",
        "query": query.clone(),
        "pattern": query,
        "payload": args,
    })
}

pub(crate) fn normalize_web_search_args(args: Value) -> Value {
    let action = args
        .get("action")
        .and_then(Value::as_str)
        .or_else(|| args.get("type").and_then(Value::as_str))
        .unwrap_or("search")
        .to_string();
    let url = args
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let pattern = args
        .get("pattern")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .or_else(|| args.get("search_query").and_then(Value::as_str))
        .or_else(|| args.get("input").and_then(Value::as_str))
        .or_else(|| (!url.is_empty()).then_some(url.as_str()))
        .or_else(|| (!pattern.is_empty()).then_some(pattern.as_str()))
        .unwrap_or_default()
        .to_string();
    let queries = args.get("queries").cloned().unwrap_or_else(|| json!([]));
    json!({
        "action": action,
        "query": query,
        "queries": queries,
        "url": url,
        "pattern": pattern,
        "payload": args,
    })
}
