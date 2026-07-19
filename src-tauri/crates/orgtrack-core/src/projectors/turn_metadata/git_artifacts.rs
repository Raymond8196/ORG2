//! Git-artifact keying and field merging for the round projection.

use super::*;

pub(super) fn artifact_key(artifact: &ExtractedGitArtifactData) -> Option<String> {
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

pub(super) fn merge_missing_artifact_fields(
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
