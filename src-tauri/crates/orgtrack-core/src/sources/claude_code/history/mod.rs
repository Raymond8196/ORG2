//! Claude Code imported history reader
//!
//! Reads Claude Code JSONL transcripts from `~/.claude/projects/*/*.jsonl` and
//! converts them into ORGII's canonical `ActivityChunk` shape for read-only
//! replay.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use core_types::activity::ActivityChunk;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::sources::imported_history::{
    self, cache as imported_cache, managed_mirror,
    metadata::{
        ImportedHistoryCacheInput, ImportedHistoryDiscoveredRecord, ImportedHistoryImpactStats,
        RoundUsage, SOURCE_CLAUDE_CODE,
    },
    paths as imported_paths, ImportedHistoryRecentPath, ImportedHistorySessionPage,
    ImportedHistorySessionRow, ImportedToolCall,
};

use super::SESSION_PREFIX as CLAUDE_CODE_SESSION_PREFIX;
// Re-exported so submodule code moved out of this file keeps resolving its
// original `super::canonical_session_id` path (whose `super` was `claude_code`)
// against this `history` module instead.
use super::canonical_session_id;

mod discovery;
mod load;
mod paths;

use discovery::*;
use load::*;
use paths::*;

const CLAUDE_CODE_PROVIDER_SLUG: &str = "claudecode";
// v4: read ai-title/custom-title records for the name, and derive diff stats
// from tool_use_result.structuredPatch instead of the old_string/new_string heuristic.
// v6: capture first-user-message uuid as the continuation dedupe group key.
// v7: capture cache_read/cache_write tokens separately (input stays cache-inclusive).
// v8: emit per-round usage rows (imported_history_round_usage).
// v9: dedup usage by message.id (one API response spans repeated JSONL lines).
const CLAUDE_CODE_METADATA_PARSER_VERSION: i64 = 9;

pub type ClaudeCodeHistorySessionRow = ImportedHistorySessionRow;
pub type ClaudeCodeHistorySessionPage = ImportedHistorySessionPage;
pub type ClaudeCodeRecentPath = ImportedHistoryRecentPath;

#[derive(Debug, Clone)]
struct ClaudeCodeHistoryMeta {
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
    model: Option<String>,
    repo_path: Option<String>,
    branch: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    rounds: Vec<RoundUsage>,
    impact: ImportedHistoryImpactStats,
    /// Set for Task-tool subagent transcripts: the parent session's frontend
    /// id (`claudecodeapp-<parent-uuid>`). `None` for ordinary top-level
    /// sessions. Non-empty values are subsumed out of the sidebar/kanban.
    parent_session_id: Option<String>,
    /// `uuid` of the first `type == "user"` line. Context-window continuation
    /// rewrites copy the conversation into a NEW session file with no link
    /// field, but message uuids are preserved — so this is a stable group key
    /// uniting a conversation's continuation siblings for dedupe.
    first_user_uuid: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeJsonlLine {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    summary: String,
    /// `ai-title` records: the auto-generated title shown in the Claude Code app.
    #[serde(default)]
    ai_title: String,
    /// `custom-title` records: a user-set title that overrides the AI title.
    #[serde(default)]
    custom_title: String,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    git_branch: String,
    #[serde(default)]
    message: Option<ClaudeMessage>,
    /// Sidecar payload on tool-result lines. For edit tools it carries a
    /// `structuredPatch` with exact `+`/`-` diff lines.
    #[serde(default)]
    tool_use_result: Option<Value>,
    /// `true` on every line of a Task-tool subagent transcript
    /// (`<parent-uuid>/subagents/agent-*.jsonl`). Marks the whole file as a
    /// child session that must be subsumed under its parent.
    #[serde(default)]
    is_sidechain: bool,
    /// The parent session's UUID. On a subagent transcript every line carries
    /// the spawning session's id here (not the subagent's own `agent-*` stem),
    /// which is exactly the parent linkage we need.
    #[serde(default)]
    session_id: String,
    /// Per-message uuid, preserved verbatim across continuation rewrites.
    #[serde(default)]
    uuid: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeMessage {
    /// Assistant API-response id (`msg_…`). One response is written across
    /// several JSONL lines that each repeat the cumulative `usage`, so tokens
    /// are counted once per unique id.
    #[serde(default)]
    id: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    content: Value,
    #[serde(default)]
    usage: Option<ClaudeUsage>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
    #[serde(default)]
    cache_read_input_tokens: i64,
    #[serde(default)]
    cache_creation_input_tokens: i64,
}

#[derive(Debug, Clone)]
struct ClaudeSessionTitle {
    name: String,
    name_source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionMetadataFile {
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    name_source: Option<String>,
}

#[derive(Debug, Clone)]
struct ClaudeCodeSessionFile {
    file_stem: String,
    path: PathBuf,
}

pub fn list_claude_code_history_sessions_paginated(
    conn: &mut Connection,
    limit: usize,
    offset: usize,
) -> Result<ClaudeCodeHistorySessionPage, String> {
    sync_claude_code_history_cache(conn)?;
    imported_cache::query_imported_session_page_from_conn(conn, SOURCE_CLAUDE_CODE, limit, offset)
}

pub fn list_claude_code_recent_paths(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<ClaudeCodeRecentPath>, String> {
    sync_claude_code_history_cache(conn)?;
    imported_cache::query_imported_recent_paths_from_conn(conn, SOURCE_CLAUDE_CODE, limit)
}

pub fn load_claude_code_history_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = claude_file_stem_from_session_id(session_id)?;
    let path = resolve_claude_session_path(conn, file_stem)?;
    load_claude_code_history_from_path(session_id, &path)
}

/// Cheap freshness probe for one session's transcript: `(mtime_ms, size_bytes)`.
/// Auto-refresh callers compare it against the previous probe and skip the
/// full read/parse/merge pipeline when the source file has not changed —
/// which is every tick for a finished session. Returns `Ok(None)` when the
/// transcript file is missing (caller falls back to a full refresh attempt).
pub fn stat_claude_code_history_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<(i64, u64)>, String> {
    let file_stem = claude_file_stem_from_session_id(session_id)?;
    let path = resolve_claude_session_path(conn, file_stem)?;
    match fs::metadata(&path) {
        Ok(metadata) => {
            let mtime_ms = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            Ok(Some((mtime_ms, metadata.len())))
        }
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
#[path = "../history_tests.rs"]
mod tests;
