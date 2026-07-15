//! Resource-interaction extraction from normalized activity chunks.
//!
//! Imported histories from Claude Code, Codex, Cursor, and ORG2's own event
//! cache all converge on [`ActivityChunk`]. This module classifies only that
//! normalized shape so historical reconciliation does not depend on vendor
//! payloads or copy the hook adapter's field heuristics into the app layer.

use core_types::activity::ActivityChunk;
use serde_json::Value;

use crate::canonical::{ResourceAction, ResourceInteractionOutcome};
use crate::sources::imported_history::{
    ACTION_TYPE_TOOL_CALL, FUNCTION_CODE_SEARCH, FUNCTION_EDIT_FILE, FUNCTION_GLOB_FILE_SEARCH,
    FUNCTION_READ_FILE,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityFileInteraction {
    pub file_path: String,
    pub action: ResourceAction,
}

pub fn file_interactions_from_activity_chunk(
    chunk: &ActivityChunk,
) -> Vec<ActivityFileInteraction> {
    if chunk.action_type != ACTION_TYPE_TOOL_CALL {
        return Vec::new();
    }

    let action = match chunk.function.as_str() {
        FUNCTION_READ_FILE => Some(ResourceAction::Read),
        FUNCTION_EDIT_FILE => Some(ResourceAction::Write),
        FUNCTION_CODE_SEARCH | FUNCTION_GLOB_FILE_SEARCH => Some(ResourceAction::Search),
        _ => action_for_tool_name(&chunk.function),
    };
    let Some(default_action) = action else {
        return Vec::new();
    };

    let mut interactions = patch_text(&chunk.args)
        .map(extract_patch_file_actions)
        .unwrap_or_default();
    if interactions.is_empty() {
        interactions.extend(
            explicit_paths(&chunk.args)
                .into_iter()
                .chain(explicit_paths(&chunk.result))
                .map(|file_path| ActivityFileInteraction {
                    file_path,
                    action: default_action,
                }),
        );
    }
    interactions.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.action.as_str().cmp(right.action.as_str()))
    });
    interactions.dedup();
    interactions
}

pub fn interaction_outcome_from_activity_chunk(
    chunk: &ActivityChunk,
) -> ResourceInteractionOutcome {
    if chunk.result.get("success").and_then(Value::as_bool) == Some(false)
        || chunk
            .result
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| {
                matches!(
                    status.trim().to_ascii_lowercase().as_str(),
                    "failed" | "error" | "cancelled" | "canceled" | "rejected"
                )
            })
    {
        ResourceInteractionOutcome::Failed
    } else {
        ResourceInteractionOutcome::Succeeded
    }
}

pub fn activity_chunk_source_event_id(
    chunk: &ActivityChunk,
    interaction: &ActivityFileInteraction,
) -> String {
    let base = chunk
        .result
        .get("call_id")
        .or_else(|| chunk.result.get("callId"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&chunk.chunk_id);
    format!(
        "{base}:{}:{}",
        interaction.action.as_str(),
        interaction.file_path
    )
}

fn action_for_tool_name(tool_name: &str) -> Option<ResourceAction> {
    let normalized = tool_name.to_ascii_lowercase();
    if normalized.contains("delete") || normalized.contains("remove_file") {
        Some(ResourceAction::Delete)
    } else if normalized.contains("write")
        || normalized.contains("edit")
        || normalized.contains("patch")
        || normalized.contains("notebook")
    {
        Some(ResourceAction::Write)
    } else if normalized.contains("read") || normalized.contains("view_file") {
        Some(ResourceAction::Read)
    } else if normalized.contains("grep")
        || normalized.contains("search")
        || normalized.contains("glob")
    {
        Some(ResourceAction::Search)
    } else {
        None
    }
}

fn explicit_paths(value: &Value) -> Vec<String> {
    const PATH_FIELDS: &[&str] = &[
        "file_path",
        "filePath",
        "path",
        "notebook_path",
        "notebookPath",
        "target_file",
        "targetFile",
        "relativeWorkspacePath",
    ];
    let mut paths = Vec::new();
    if let Some(object) = value.as_object() {
        for field in PATH_FIELDS {
            match object.get(*field) {
                Some(Value::String(path)) if !path.trim().is_empty() => paths.push(path.clone()),
                Some(Value::Array(values)) => paths.extend(
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .filter(|path| !path.trim().is_empty())
                        .map(str::to_string),
                ),
                _ => {}
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn patch_text(value: &Value) -> Option<&str> {
    ["patch", "patch_text", "patchText", "diff"]
        .into_iter()
        .find_map(|field| value.get(field).and_then(Value::as_str))
}

fn extract_patch_file_actions(patch: &str) -> Vec<ActivityFileInteraction> {
    let mut interactions = Vec::new();
    for line in patch.lines() {
        let trimmed = line.trim();
        let candidate = [
            ("*** Add File:", ResourceAction::Create),
            ("*** Update File:", ResourceAction::Write),
            ("*** Delete File:", ResourceAction::Delete),
            ("*** Move to:", ResourceAction::Rename),
        ]
        .into_iter()
        .find_map(|(prefix, action)| {
            trimmed
                .strip_prefix(prefix)
                .map(|path| (path.trim(), action))
        });
        if let Some((path, action)) = candidate {
            if !path.is_empty() {
                interactions.push(ActivityFileInteraction {
                    file_path: path.to_string(),
                    action,
                });
            }
        }
    }
    interactions
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chunk(function: &str, args: Value) -> ActivityChunk {
        let mut chunk = ActivityChunk::new("session-1", ACTION_TYPE_TOOL_CALL, function);
        chunk.chunk_id = "chunk-1".to_string();
        chunk.args = args;
        chunk.result = json!({"success": true, "call_id": "tool-1"});
        chunk
    }

    #[test]
    fn extracts_normalized_read_and_stable_source_event_id() {
        let chunk = chunk(FUNCTION_READ_FILE, json!({"filePath": "src/lib.rs"}));
        let interactions = file_interactions_from_activity_chunk(&chunk);
        assert_eq!(
            interactions,
            vec![ActivityFileInteraction {
                file_path: "src/lib.rs".to_string(),
                action: ResourceAction::Read,
            }]
        );
        assert_eq!(
            activity_chunk_source_event_id(&chunk, &interactions[0]),
            "tool-1:read:src/lib.rs"
        );
    }

    #[test]
    fn preserves_per_file_patch_actions() {
        let chunk = chunk(
            FUNCTION_EDIT_FILE,
            json!({
                "patch": "*** Begin Patch\n*** Add File: src/new.rs\n+x\n*** Delete File: src/old.rs\n*** End Patch"
            }),
        );
        let interactions = file_interactions_from_activity_chunk(&chunk);
        assert_eq!(interactions.len(), 2);
        assert_eq!(interactions[0].action, ResourceAction::Create);
        assert_eq!(interactions[1].action, ResourceAction::Delete);
    }

    #[test]
    fn maps_failed_tool_results_to_failed_outcome() {
        let mut chunk = chunk(FUNCTION_EDIT_FILE, json!({"path": "src/lib.rs"}));
        chunk.result = json!({"success": false});
        assert_eq!(
            interaction_outcome_from_activity_chunk(&chunk),
            ResourceInteractionOutcome::Failed
        );
    }
}
