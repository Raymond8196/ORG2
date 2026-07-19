//! Qoder imported-history reader
//!
//! Reads Qoder's per-project conversation-history store (see the module docs
//! for the on-disk layout) and converts each transcript into ORGII's canonical
//! `ActivityChunk` shape for read-only replay. The transcript lines carry
//! Anthropic-style content blocks, so tool calls and their results are paired
//! back together like the Cline reader does.
//!
//! Task directory names are only unique within one project cache dir (they are
//! truncated task-id prefixes), so the source session id is the composite
//! `<project-dir>/<task-dir>` — directory names cannot contain `/`, which makes
//! the split-back unambiguous.

use serde::Deserialize;
use serde_json::Value;

use crate::sources::imported_history::metadata::{
    ImportedHistoryDiscoveredRecord, ImportedHistoryImpactStats, ImportedHistoryRecordSignature,
};
use crate::sources::imported_history::{
    ImportedHistoryRecentPath, ImportedHistorySessionPage, ImportedHistorySessionRow,
};

// Referenced unqualified by `history_tests.rs` (via `use super::*`); the reader
// modules import it directly where they need it.
#[cfg(test)]
use crate::sources::imported_history;

mod discovery;
mod parse;
mod session;

pub use discovery::*;
pub use session::*;
use parse::*;

pub const QODER_SESSION_PREFIX: &str = "qoderapp-";
const QODER_PROVIDER_SLUG: &str = "qoder";
// Version 2 derives per-session file impact from the chat-editing snapshot
// store (the transcript itself carries no edit data).
const QODER_METADATA_PARSER_VERSION: i64 = 2;
const CONVERSATION_HISTORY_DIR: &str = "conversation-history";
/// Global-storage key holding the quest task list (title/status/timestamps).
const QUEST_SNAPSHOT_KEY: &str = "aicoding.questTaskListSnapshot";
/// Cap a single tool-result body so a runaway command output can't bloat the
/// cache/replay payload. The replay UI virtualizes long text anyway.
pub(super) const MAX_TOOL_OUTPUT_CHARS: usize = 50_000;

pub type QoderHistorySessionRow = ImportedHistorySessionRow;
pub type QoderHistorySessionPage = ImportedHistorySessionPage;
pub type QoderRecentPath = ImportedHistoryRecentPath;

#[derive(Debug, Clone)]
struct QoderHistoryMeta {
    source_session_id: String,
    session_id: String,
    source_path: String,
    source_record_key: String,
    source_mtime_ms: i64,
    source_size_bytes: i64,
    source_fingerprint: String,
    name: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    repo_path: Option<String>,
    impact: ImportedHistoryImpactStats,
}

#[derive(Debug, Clone)]
struct QoderDiscoveredRecord {
    record: ImportedHistoryDiscoveredRecord,
    snapshot: Option<QoderQuestTask>,
}

impl QoderDiscoveredRecord {
    fn signature(&self) -> ImportedHistoryRecordSignature {
        self.record.signature()
    }
}

/// One task entry from the `aicoding.questTaskListSnapshot` global-storage key.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct QoderQuestTask {
    id: String,
    name: String,
    title: String,
    query: String,
    create_time: i64,
    updated_at_timestamp: i64,
    last_user_query_at: i64,
    file_path: String,
}

/// One transcript JSONL line: `{role, message:{content:[blocks]}}`.
#[derive(Debug, Default, Deserialize)]
struct QoderTranscriptLine {
    #[serde(default)]
    role: String,
    #[serde(default)]
    message: QoderTranscriptMessage,
}

#[derive(Debug, Default, Deserialize)]
struct QoderTranscriptMessage {
    #[serde(default)]
    content: Value,
}

#[cfg(test)]
#[path = "../history_tests.rs"]
mod tests;
