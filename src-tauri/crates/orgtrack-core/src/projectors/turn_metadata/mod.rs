//! Provider-neutral per-round resource and development metadata projection.
//!
//! Host applications feed normalized tool metadata into this projector and
//! may materialize the result in their own turn cache. Provider adapters do
//! not leak into the projection: Claude, Codex, Cursor, ORG2, and future
//! providers all converge on tool name/input/result plus a timestamp.
//!
//! The projection keeps both the full resource interaction summary
//! (read/search/write/create/delete/rename) and the edit-only file summary
//! used by review UI. Malformed JSON in one event is skipped rather than
//! failing the whole round.

use std::collections::HashMap;

use core_types::activity::ActivityChunk;
use core_types::extracted::{ExtractedGitArtifactData, GitArtifactKind};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::canonical::{ResourceAction, ResourceInteractionOutcome};
use crate::development_artifact::parse_git_artifacts_from_tool_payload;
use crate::resource_interaction::{
    action_for_tool_name, file_interactions_from_tool, interaction_outcome_from_tool_result,
};

mod files;
mod git_artifacts;

use files::*;
use git_artifacts::*;

const STATUS_CREATED: &str = "created";
const STATUS_DELETED: &str = "deleted";
const STATUS_MODIFIED: &str = "modified";

/// One file the round wrote to, with summed line stats. Serialized as the
/// camelCase shape the frontend `FileChangeInfo` expects.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnModifiedFile {
    pub path: String,
    pub file_name: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

/// One privacy-safe aggregate for a path/action pair inside a round. Repeated
/// tool observations increment `count`; raw commands, results, query text, and
/// file contents never enter this projection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnResourceInteraction {
    pub path: String,
    pub file_name: String,
    pub action: ResourceAction,
    pub outcome: ResourceInteractionOutcome,
    pub count: u32,
    pub first_occurred_at: String,
    pub last_occurred_at: String,
}

/// Owned per-round projection produced directly from an imported provider's
/// normalized activity stream. Hosts may map this into their own read cache or
/// wire type without persisting the provider transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedTurnMetadata {
    pub turn_id: String,
    pub start_sequence: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub user_preview: String,
    pub event_count: i64,
    pub body_event_count: i64,
    pub modified_files: Vec<TurnModifiedFile>,
    pub resource_interactions: Vec<TurnResourceInteraction>,
    pub git_artifacts: Vec<ExtractedGitArtifactData>,
}

/// Mutable, order-preserving Orgtrack projection for one conversational
/// round. It is provider-neutral and safe to embed in a host's materialized
/// turn cache.
#[derive(Debug, Default, Clone)]
pub struct TurnMetadataAccumulator {
    modified_files: Vec<TurnModifiedFile>,
    resource_interactions: Vec<TurnResourceInteraction>,
    resource_index: HashMap<(String, ResourceAction, ResourceInteractionOutcome), usize>,
    git_artifacts: Vec<ExtractedGitArtifactData>,
    artifact_index: HashMap<String, usize>,
}

impl TurnMetadataAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one normalized tool event when no source timestamp is available.
    pub fn add_event(&mut self, function_name: Option<&str>, args_json: &str, result_json: &str) {
        self.add_event_at(function_name, args_json, result_json, "");
    }

    /// Fold one normalized tool event into the round projection.
    pub fn add_event_at(
        &mut self,
        function_name: Option<&str>,
        args_json: &str,
        result_json: &str,
        occurred_at: &str,
    ) {
        let Some(function_name) = function_name else {
            return;
        };
        let args = serde_json::from_str::<Value>(args_json).unwrap_or(Value::Null);
        let result = serde_json::from_str::<Value>(result_json).unwrap_or(Value::Null);
        let outcome = interaction_outcome_from_tool_result(&result);

        for interaction in file_interactions_from_tool(function_name, &args, Some(&result)) {
            self.merge_resource_interaction(
                interaction.file_path,
                interaction.action,
                outcome,
                occurred_at,
            );
        }

        if outcome != ResourceInteractionOutcome::Failed {
            for change in extract_event_files(function_name, &args, &result) {
                self.merge_modified_file(change);
            }
        }

        for artifact in parse_git_artifacts_from_tool_payload(args_json, result_json) {
            self.merge_artifact(artifact);
        }
    }

    fn merge_modified_file(&mut self, change: TurnModifiedFile) {
        if change.path.is_empty() {
            return;
        }
        if let Some(existing) = self
            .modified_files
            .iter_mut()
            .find(|file| file.path == change.path)
        {
            existing.additions = existing.additions.saturating_add(change.additions);
            existing.deletions = existing.deletions.saturating_add(change.deletions);
            // Latest event wins for status: a create-then-edit shows the net
            // "created"/"modified" as it last appeared chronologically.
            existing.status = change.status;
            if existing.file_name.is_empty() {
                existing.file_name = change.file_name;
            }
        } else {
            self.modified_files.push(change);
        }
    }

    fn merge_resource_interaction(
        &mut self,
        path: String,
        action: ResourceAction,
        outcome: ResourceInteractionOutcome,
        occurred_at: &str,
    ) {
        if path.trim().is_empty() {
            return;
        }
        let key = (path.clone(), action, outcome);
        if let Some(index) = self.resource_index.get(&key).copied() {
            let existing = &mut self.resource_interactions[index];
            existing.count = existing.count.saturating_add(1);
            if existing.first_occurred_at.is_empty()
                || (!occurred_at.is_empty() && occurred_at < existing.first_occurred_at.as_str())
            {
                existing.first_occurred_at = occurred_at.to_string();
            }
            if occurred_at > existing.last_occurred_at.as_str() {
                existing.last_occurred_at = occurred_at.to_string();
            }
            return;
        }
        self.resource_index
            .insert(key, self.resource_interactions.len());
        self.resource_interactions.push(TurnResourceInteraction {
            file_name: file_name_for(&path),
            path,
            action,
            outcome,
            count: 1,
            first_occurred_at: occurred_at.to_string(),
            last_occurred_at: occurred_at.to_string(),
        });
    }

    fn merge_artifact(&mut self, artifact: ExtractedGitArtifactData) {
        let Some(key) = artifact_key(&artifact) else {
            return;
        };
        if let Some(index) = self.artifact_index.get(&key).copied() {
            merge_missing_artifact_fields(&mut self.git_artifacts[index], artifact);
            return;
        }
        self.artifact_index.insert(key, self.git_artifacts.len());
        self.git_artifacts.push(artifact);
    }

    pub fn modified_files(&self) -> &[TurnModifiedFile] {
        &self.modified_files
    }

    /// Compatibility name for hosts that only consume the edit projection.
    pub fn files(&self) -> &[TurnModifiedFile] {
        self.modified_files()
    }

    pub fn resource_interactions(&self) -> &[TurnResourceInteraction] {
        &self.resource_interactions
    }

    pub fn git_artifacts(&self) -> &[ExtractedGitArtifactData] {
        &self.git_artifacts
    }
}

#[derive(Debug)]
struct ImportedTurnDraft {
    turn_id: String,
    start_sequence: i64,
    started_at: String,
    ended_at: Option<String>,
    user_preview: String,
    event_count: i64,
    body_event_count: i64,
    metadata: TurnMetadataAccumulator,
}

impl ImportedTurnDraft {
    fn finish(self) -> ProjectedTurnMetadata {
        ProjectedTurnMetadata {
            turn_id: self.turn_id,
            start_sequence: self.start_sequence,
            started_at: self.started_at,
            ended_at: self.ended_at,
            user_preview: self.user_preview,
            event_count: self.event_count,
            body_event_count: self.body_event_count,
            modified_files: self.metadata.modified_files,
            resource_interactions: self.metadata.resource_interactions,
            git_artifacts: self.metadata.git_artifacts,
        }
    }
}

/// Project every user-message-bounded round from an existing imported-history
/// loader. Actor/execution-thread ids stay on their own dimension and are never
/// reused as conversational turn ids.
pub fn project_activity_chunks(chunks: &[ActivityChunk]) -> Vec<ProjectedTurnMetadata> {
    let mut rounds = Vec::new();
    let mut current: Option<ImportedTurnDraft> = None;

    for (sequence, chunk) in chunks.iter().enumerate() {
        if chunk.function == crate::sources::imported_history::FUNCTION_USER_MESSAGE {
            if let Some(completed) = current.take() {
                rounds.push(completed.finish());
            }
            if chunk.chunk_id.trim().is_empty() {
                continue;
            }
            current = Some(ImportedTurnDraft {
                turn_id: chunk.chunk_id.clone(),
                start_sequence: sequence as i64,
                started_at: chunk.created_at.clone(),
                ended_at: Some(chunk.created_at.clone()),
                user_preview: activity_chunk_text(chunk),
                event_count: 1,
                body_event_count: 0,
                metadata: TurnMetadataAccumulator::new(),
            });
            continue;
        }

        let Some(turn) = current.as_mut() else {
            continue;
        };
        turn.event_count = turn.event_count.saturating_add(1);
        turn.body_event_count = turn.body_event_count.saturating_add(1);
        if !chunk.created_at.is_empty()
            && turn
                .ended_at
                .as_deref()
                .is_none_or(|ended_at| chunk.created_at.as_str() > ended_at)
        {
            turn.ended_at = Some(chunk.created_at.clone());
        }
        let args_json = serde_json::to_string(&chunk.args).unwrap_or_else(|_| "null".to_string());
        let result_json =
            serde_json::to_string(&chunk.result).unwrap_or_else(|_| "null".to_string());
        turn.metadata.add_event_at(
            Some(&chunk.function),
            &args_json,
            &result_json,
            &chunk.created_at,
        );
    }

    if let Some(completed) = current {
        rounds.push(completed.finish());
    }
    rounds
}

fn activity_chunk_text(chunk: &ActivityChunk) -> String {
    ["content", "message", "prompt", "text", "query"]
        .into_iter()
        .find_map(|field| chunk.args.get(field).and_then(Value::as_str))
        .or_else(|| chunk.args.as_str())
        .unwrap_or_default()
        .to_string()
}

/// Provider-neutral modification predicate used by tests and host adapters.
pub fn is_file_modify_function(name: &str) -> bool {
    action_for_tool_name(name).is_some_and(is_modifying_action)
}

fn is_modifying_action(action: ResourceAction) -> bool {
    matches!(
        action,
        ResourceAction::Write
            | ResourceAction::Create
            | ResourceAction::Delete
            | ResourceAction::Rename
    )
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
