//! File-modification extraction from normalized tool events.

use super::*;

fn status_for_interaction(name: &str, action: ResourceAction) -> &'static str {
    match action {
        ResourceAction::Create => STATUS_CREATED,
        ResourceAction::Delete => STATUS_DELETED,
        _ if name.to_ascii_lowercase().contains("create") => STATUS_CREATED,
        _ => STATUS_MODIFIED,
    }
}

pub(super) fn file_name_for(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// Read a non-negative line count from `result_json`, checking top-level and
/// the nested `success` object the file extractors write to.
fn read_lines(result: &serde_json::Value, key: &str) -> u32 {
    let direct = result.get(key).and_then(serde_json::Value::as_u64);
    let nested = result
        .get("success")
        .and_then(|success| success.get(key))
        .and_then(serde_json::Value::as_u64);
    direct.or(nested).unwrap_or(0) as u32
}

fn content_line_count(args: &serde_json::Value) -> u32 {
    args.get("new_string")
        .and_then(serde_json::Value::as_str)
        .or_else(|| args.get("content").and_then(serde_json::Value::as_str))
        .or_else(|| args.get("insert_text").and_then(serde_json::Value::as_str))
        .or_else(|| args.get("file_text").and_then(serde_json::Value::as_str))
        .map(|content| content.lines().count().max(1) as u32)
        .unwrap_or(0)
}

fn fallback_line_stats(
    function_name: &str,
    action: ResourceAction,
    args: &serde_json::Value,
) -> (u32, u32) {
    let line_count = content_line_count(args);
    if line_count == 0 {
        return (0, 0);
    }

    let normalized = function_name.to_ascii_lowercase();
    match action {
        ResourceAction::Delete => (0, line_count),
        _ if normalized.contains("edit") || normalized.contains("replace") => {
            let removed = args
                .get("old_string")
                .and_then(serde_json::Value::as_str)
                .or_else(|| args.get("old_str").and_then(serde_json::Value::as_str))
                .map(|content| content.lines().count().max(1) as u32)
                .unwrap_or(0);
            (line_count, removed)
        }
        _ => (line_count, 0),
    }
}

pub(super) fn extract_event_files(
    function_name: &str,
    args: &Value,
    result: &Value,
) -> Vec<TurnModifiedFile> {
    if function_name.to_ascii_lowercase().contains("patch") {
        return extract_patch_files(args, result);
    }

    file_interactions_from_tool(function_name, args, Some(result))
        .into_iter()
        .filter(|interaction| is_modifying_action(interaction.action))
        .map(|interaction| {
            let result_additions = read_lines(result, "linesAdded");
            let result_deletions = read_lines(result, "linesRemoved");
            let (fallback_additions, fallback_deletions) =
                if result_additions == 0 && result_deletions == 0 {
                    fallback_line_stats(function_name, interaction.action, args)
                } else {
                    (0, 0)
                };
            TurnModifiedFile {
                file_name: file_name_for(&interaction.file_path),
                status: status_for_interaction(function_name, interaction.action).to_string(),
                additions: result_additions.saturating_add(fallback_additions),
                deletions: result_deletions.saturating_add(fallback_deletions),
                path: interaction.file_path,
            }
        })
        .collect()
}

/// apply_patch can touch multiple files. Prefer the structured `segments`
/// result (carries per-file line stats), then parse `patch_text` so fallback
/// rows still carry per-file line stats. Use `filePaths` only when the patch
/// text is unavailable.
fn extract_patch_files(
    args: &serde_json::Value,
    result: &serde_json::Value,
) -> Vec<TurnModifiedFile> {
    if let Some(segments) = result
        .get("segments")
        .or_else(|| {
            result
                .get("success")
                .and_then(|value| value.get("segments"))
        })
        .and_then(serde_json::Value::as_array)
    {
        let mut files = Vec::new();
        for segment in segments {
            let path = segment
                .get("filePath")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            if path.is_empty() {
                continue;
            }
            let is_deleted = segment
                .get("isDeleted")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            files.push(TurnModifiedFile {
                file_name: file_name_for(&path),
                status: if is_deleted {
                    STATUS_DELETED
                } else {
                    STATUS_MODIFIED
                }
                .to_string(),
                additions: read_lines(segment, "linesAdded"),
                deletions: read_lines(segment, "linesRemoved"),
                path,
            });
        }
        if !files.is_empty() {
            return files;
        }
    }

    let patch_text = args
        .get("patch_text")
        .or_else(|| args.get("patch"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let patch_files = extract_files_from_patch_text(patch_text);
    if !patch_files.is_empty() {
        return patch_files;
    }

    if let Some(paths) = result
        .get("filePaths")
        .and_then(serde_json::Value::as_array)
    {
        let collected: Vec<TurnModifiedFile> = paths
            .iter()
            .filter_map(serde_json::Value::as_str)
            .filter(|path| !path.is_empty())
            .map(|path| TurnModifiedFile {
                file_name: file_name_for(path),
                status: STATUS_MODIFIED.to_string(),
                additions: 0,
                deletions: 0,
                path: path.to_string(),
            })
            .collect();
        if !collected.is_empty() {
            return collected;
        }
    }

    Vec::new()
}

fn extract_files_from_patch_text(patch_text: &str) -> Vec<TurnModifiedFile> {
    let mut files: Vec<TurnModifiedFile> = Vec::new();
    let mut current_path: Option<String> = None;

    for line in patch_text.lines() {
        let trimmed = line.trim();
        let header_path = trimmed
            .strip_prefix("*** Add File:")
            .or_else(|| trimmed.strip_prefix("*** Update File:"))
            .or_else(|| trimmed.strip_prefix("*** Delete File:"))
            .or_else(|| trimmed.strip_prefix("+++ b/"))
            .or_else(|| trimmed.strip_prefix("--- a/"))
            .map(str::trim)
            .filter(|path| !path.is_empty() && *path != "/dev/null");

        if let Some(path) = header_path {
            let path = path.to_string();
            if !files.iter().any(|seen| seen.path == path) {
                files.push(TurnModifiedFile {
                    file_name: file_name_for(&path),
                    status: STATUS_MODIFIED.to_string(),
                    additions: 0,
                    deletions: 0,
                    path: path.clone(),
                });
            }
            current_path = Some(path);
            continue;
        }

        let Some(path) = current_path.as_deref() else {
            continue;
        };
        if line.starts_with('+') && !line.starts_with("+++") {
            if let Some(file) = files.iter_mut().find(|file| file.path == path) {
                file.additions = file.additions.saturating_add(1);
            }
        } else if line.starts_with('-') && !line.starts_with("---") {
            if let Some(file) = files.iter_mut().find(|file| file.path == path) {
                file.deletions = file.deletions.saturating_add(1);
            }
        }
    }

    files
}
