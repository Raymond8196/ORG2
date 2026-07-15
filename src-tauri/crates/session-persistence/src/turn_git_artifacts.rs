//! Per-round Git artifact extraction for the durable turn index.

use std::collections::HashMap;

use core_types::extracted::{ExtractedGitArtifactData, GitArtifactKind};
use git::git_artifacts::parse_git_artifacts_from_tool_payload;

#[derive(Debug, Default, Clone)]
pub struct TurnGitArtifactAccumulator {
    artifacts: Vec<ExtractedGitArtifactData>,
    index_by_key: HashMap<String, usize>,
}

impl TurnGitArtifactAccumulator {
    pub fn add_event(&mut self, function_name: Option<&str>, args_json: &str, result_json: &str) {
        if function_name != Some(agent_core::tools::names::RUN_SHELL) {
            return;
        }
        for artifact in parse_git_artifacts_from_tool_payload(args_json, result_json) {
            self.merge(artifact);
        }
    }

    pub fn artifacts(&self) -> &[ExtractedGitArtifactData] {
        &self.artifacts
    }

    fn merge(&mut self, artifact: ExtractedGitArtifactData) {
        let Some(key) = artifact_key(&artifact) else {
            return;
        };
        if let Some(index) = self.index_by_key.get(&key).copied() {
            merge_missing_fields(&mut self.artifacts[index], artifact);
            return;
        }
        self.index_by_key.insert(key, self.artifacts.len());
        self.artifacts.push(artifact);
    }
}

fn artifact_key(artifact: &ExtractedGitArtifactData) -> Option<String> {
    match artifact.kind {
        GitArtifactKind::Commit => artifact
            .sha
            .as_ref()
            .filter(|sha| !sha.trim().is_empty())
            .map(|sha| format!("commit:{}", sha.to_ascii_lowercase())),
        GitArtifactKind::PullRequest => artifact
            .repo_full_name
            .as_ref()
            .zip(artifact.pr_number)
            .map(|(repo, number)| format!("pr:{}#{number}", repo.to_ascii_lowercase()))
            .or_else(|| artifact.url.as_ref().map(|url| format!("pr:{url}"))),
    }
}

fn merge_missing_fields(
    existing: &mut ExtractedGitArtifactData,
    incoming: ExtractedGitArtifactData,
) {
    if existing.url.is_none() {
        existing.url = incoming.url;
    }
    if existing.repo_full_name.is_none() {
        existing.repo_full_name = incoming.repo_full_name;
    }
    if existing.sha.is_none() {
        existing.sha = incoming.sha;
    }
    if existing.short_sha.is_none() {
        existing.short_sha = incoming.short_sha;
    }
    if existing.subject.is_none() {
        existing.subject = incoming.subject;
    }
    if existing.pr_number.is_none() {
        existing.pr_number = incoming.pr_number;
    }
    if existing.pr_title.is_none() {
        existing.pr_title = incoming.pr_title;
    }
    if existing.source_branch.is_none() {
        existing.source_branch = incoming.source_branch;
    }
    if existing.target_branch.is_none() {
        existing.target_branch = incoming.target_branch;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulates_commit_and_pr_from_completed_shell_events() {
        let mut accumulator = TurnGitArtifactAccumulator::default();
        accumulator.add_event(
            Some(agent_core::tools::names::RUN_SHELL),
            r#"{"command":"git commit -m metadata"}"#,
            r#"{"success":{"command":"git commit -m metadata","stdout":"[feature abc1234] metadata","exitCode":0}}"#,
        );
        accumulator.add_event(
            Some(agent_core::tools::names::RUN_SHELL),
            r#"{"command":"gh pr create"}"#,
            r#"{"success":{"command":"gh pr create","stdout":"https://github.com/yorgai/ORG2/pull/387","exitCode":0}}"#,
        );

        assert_eq!(accumulator.artifacts().len(), 2);
        assert_eq!(accumulator.artifacts()[0].sha.as_deref(), Some("abc1234"));
        assert_eq!(accumulator.artifacts()[1].pr_number, Some(387));
    }
}
