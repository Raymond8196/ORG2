use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::*;

use super::super::history::MAX_TOOL_OUTPUT_CHARS;
use crate::sources::imported_history::metadata::ImportedHistoryImpactStats;

/// Real before/after contents for the files a session edited, from VS Code's
/// chat-editing snapshot store:
/// `workspaceStorage/<ws>/chatEditingSessions/<taskId>.session.execution/`
/// holds a `state.json` mapping each resource to `originalHash`/`currentHash`,
/// with the content-addressed snapshot bodies under `contents/<hash>`.
/// Returns `path → (old_content, new_content)`.
pub(super) fn edit_snapshots_for_task(task_id: &str) -> HashMap<String, (String, String)> {
    edit_snapshots(task_id, Some(task_id))
}

fn edit_snapshots(
    task_dir_name: &str,
    full_task_id: Option<&str>,
) -> HashMap<String, (String, String)> {
    let mut snapshots = HashMap::new();
    for dir in edit_store_paths(
        &qoder_workspace_storage_dirs(),
        task_dir_name,
        full_task_id,
    ) {
        for (path, contents) in edit_snapshots_from_session_dir(&dir) {
            snapshots.entry(path).or_insert(contents);
        }
    }
    snapshots
}

/// Per-session file impact (`files changed / +lines / -lines`) derived from
/// the chat-editing snapshot store — the durable transcript carries no edit
/// data, so the sidebar/kanban counts come from here. Zeroed when no store
/// survives for the session.
pub(in crate::sources::qoder) fn session_edit_impact(
    task_dir_name: &str,
    full_task_id: Option<&str>,
) -> ImportedHistoryImpactStats {
    impact_from_snapshots(&edit_snapshots(task_dir_name, full_task_id))
}

pub(super) fn impact_from_snapshots(
    snapshots: &HashMap<String, (String, String)>,
) -> ImportedHistoryImpactStats {
    let mut touched_files: Vec<String> = snapshots.keys().cloned().collect();
    touched_files.sort();
    let (mut lines_added, mut lines_removed) = (0_i64, 0_i64);
    for (old_content, new_content) in snapshots.values() {
        let (added, removed) = numstat_between(old_content, new_content);
        lines_added += added;
        lines_removed += removed;
    }
    ImportedHistoryImpactStats {
        files_changed: touched_files.len() as i64,
        lines_added,
        lines_removed,
        touched_files,
    }
}

/// Real line-level numstat between two full file bodies.
fn numstat_between(old_content: &str, new_content: &str) -> (i64, i64) {
    similar::TextDiff::from_lines(old_content, new_content)
        .iter_all_changes()
        .fold((0, 0), |(added, removed), change| match change.tag() {
            similar::ChangeTag::Insert => (added + 1, removed),
            similar::ChangeTag::Delete => (added, removed + 1),
            similar::ChangeTag::Equal => (added, removed),
        })
}

/// Change-signature of the session's edit store (`state.json` mtime+size per
/// workspace). Folded into the discovery fingerprint so edits that land after
/// a sync re-parse the session even when the transcript itself is unchanged.
pub(in crate::sources::qoder) fn edit_store_signature(
    task_dir_name: &str,
    full_task_id: Option<&str>,
) -> String {
    edit_store_paths(
        &qoder_workspace_storage_dirs(),
        task_dir_name,
        full_task_id,
    )
    .iter()
    .filter_map(|dir| {
        let metadata = fs::metadata(dir.join("state.json")).ok()?;
        let mtime_ns = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|since| since.as_nanos() as i64)
            .unwrap_or_default();
        Some(format!("{mtime_ns}:{}", metadata.len()))
    })
    .collect::<Vec<_>>()
    .join("|")
}

/// The session's chat-editing store dirs across every workspace. With only a
/// truncated dir name, a prefix that matches two DISTINCT task ids is
/// ambiguous and resolves to nothing.
pub(super) fn edit_store_paths(
    storage_dirs: &[PathBuf],
    task_dir_name: &str,
    full_task_id: Option<&str>,
) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut distinct_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for storage in storage_dirs {
        let Ok(workspace_entries) = fs::read_dir(storage) else {
            continue;
        };
        for workspace in workspace_entries.flatten() {
            let base = workspace.path().join("chatEditingSessions");
            if let Some(task_id) = full_task_id {
                let dir = base.join(format!("{task_id}{SESSION_ID_SUFFIX}"));
                if dir.join("state.json").is_file() {
                    found.push(dir);
                }
                continue;
            }
            let Ok(session_entries) = fs::read_dir(&base) else {
                continue;
            };
            for session_entry in session_entries.flatten() {
                let name = session_entry.file_name().to_string_lossy().to_string();
                let Some(task_id) = name.strip_suffix(SESSION_ID_SUFFIX) else {
                    continue;
                };
                if task_id.starts_with(task_dir_name) {
                    distinct_ids.insert(task_id.to_string());
                    found.push(session_entry.path());
                }
            }
        }
    }
    if full_task_id.is_none() && distinct_ids.len() > 1 {
        return Vec::new();
    }
    found
}

/// `<data root>/Qoder/User/workspaceStorage` candidates.
fn qoder_workspace_storage_dirs() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(data) = dirs::data_dir() {
        roots.push(data);
    }
    if let Some(config) = dirs::config_dir() {
        roots.push(config);
    }
    roots.sort();
    roots.dedup();
    roots
        .into_iter()
        .map(|root| root.join("Qoder").join("User").join("workspaceStorage"))
        .collect()
}

pub(super) fn edit_snapshots_from_session_dir(
    session_dir: &Path,
) -> HashMap<String, (String, String)> {
    let mut snapshots = HashMap::new();
    let Ok(raw) = fs::read_to_string(session_dir.join("state.json")) else {
        return snapshots;
    };
    let Ok(state) = serde_json::from_str::<Value>(&raw) else {
        return snapshots;
    };
    let Some(entries) = state
        .get("recentSnapshot")
        .and_then(|snapshot| snapshot.get("entries"))
        .and_then(Value::as_array)
    else {
        return snapshots;
    };
    for entry in entries {
        let Some(resource) = entry.get("resource").and_then(Value::as_str) else {
            continue;
        };
        let Some(path) = file_uri_to_path(resource) else {
            continue;
        };
        let content_for = |key: &str| {
            entry
                .get(key)
                .and_then(Value::as_str)
                .map(|hash| read_snapshot_content(session_dir, hash))
                .unwrap_or_default()
        };
        let old_content = content_for("originalHash");
        let new_content = content_for("currentHash");
        if old_content.is_empty() && new_content.is_empty() {
            continue;
        }
        snapshots.insert(path, (old_content, new_content));
    }
    snapshots
}

fn read_snapshot_content(session_dir: &Path, hash: &str) -> String {
    if hash.is_empty() {
        return String::new();
    }
    let Ok(content) = fs::read_to_string(session_dir.join("contents").join(hash)) else {
        return String::new();
    };
    if content.chars().count() > MAX_TOOL_OUTPUT_CHARS {
        content.chars().take(MAX_TOOL_OUTPUT_CHARS).collect()
    } else {
        content
    }
}

/// `file:///a/b%20c.py` → `/a/b c.py`.
fn file_uri_to_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    Some(percent_decode(rest))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && bytes[index + 1].is_ascii_hexdigit()
            && bytes[index + 2].is_ascii_hexdigit()
        {
            // Both hex digits are ASCII, so this byte-range slice is safe.
            if let Ok(byte) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
