use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

use crate::sources::imported_history::{
    ImportedHistoryRecentPath, ImportedHistorySessionPage, ImportedHistorySessionRow,
};

pub(crate) const CODEX_PROVIDER_SLUG: &str = "codex";
// v9: derive impact from authoritative `patch_apply_end` events (structured
// `changes` map with unified diffs) instead of only scanning `apply_patch`
// tool calls, so `exec`-wrapped and other edit paths are counted too.
// v10: read info.total_token_usage (was top-level), capture cache split +
// per-round deltas.
pub(crate) const CODEX_APP_METADATA_PARSER_VERSION: i64 = 10;

pub type CodexAppSessionRow = ImportedHistorySessionRow;
pub type CodexAppSessionPage = ImportedHistorySessionPage;
pub type CodexAppRecentPath = ImportedHistoryRecentPath;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexTranscriptLocator {
    pub source_session_id: String,
    pub session_id: String,
    pub source_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexJsonlLine {
    #[serde(default)]
    pub(crate) timestamp: Option<String>,
    #[serde(default, rename = "type")]
    pub(crate) line_type: String,
    #[serde(default)]
    pub(crate) payload: Value,
}
