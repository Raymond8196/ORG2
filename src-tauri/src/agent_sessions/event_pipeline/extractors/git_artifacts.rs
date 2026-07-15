//! Live event adapter for the canonical Git artifact parser.
//!
//! Parser behavior lives in the lower `git` crate so the live event pipeline
//! and `sessions.db` turn-index backfill cannot diverge.

pub use git::git_artifacts::{parse_git_artifacts, GitArtifactParseInput};

#[cfg(test)]
#[path = "tests/git_artifacts_tests.rs"]
mod tests;
