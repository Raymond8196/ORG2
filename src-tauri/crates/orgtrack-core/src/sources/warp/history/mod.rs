//! Warp imported history reader.
//!
//! Warp stores local agent conversations in `warp.sqlite`. Conversation-level
//! metadata is JSON in `agent_conversations`; task transcripts are protobuf
//! blobs in `agent_tasks`. This module opens the database read-only and uses
//! Warp's published protobuf descriptor to project both into ORGII's shared
//! imported-history cache and `ActivityChunk` replay format.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use chrono::NaiveDateTime;
use core_types::activity::ActivityChunk;
use prost_reflect::{DescriptorPool, DynamicMessage};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde_json::Value;

use crate::sources::imported_history::{
    self, cache as imported_cache,
    metadata::{ImportedHistoryCacheInput, ImportedHistoryImpactStats, SOURCE_WARP},
    paths as imported_paths, ImportedHistoryRecentPath, ImportedHistorySessionPage,
    ImportedHistorySessionRow, ImportedToolCall,
};

mod analyze;
mod discovery;
mod helpers;
mod sync;

use analyze::*;
use discovery::*;
use helpers::*;
use sync::*;

pub const WARP_SESSION_PREFIX: &str = "warpapp-";
const WARP_PROVIDER_SLUG: &str = "warp";
const WARP_DB_FILENAME: &str = "warp.sqlite";
const WARP_TASK_PROTO_NAME: &str = "warp.multi_agent.v1.Task";
const WARP_METADATA_PARSER_VERSION: i64 = 1;
const WARP_FILE_DESCRIPTOR_SET: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../proto/warp_multi_agent_v1.descriptor.pb"
));

static WARP_DESCRIPTOR_POOL: LazyLock<Result<DescriptorPool, String>> = LazyLock::new(|| {
    DescriptorPool::decode(WARP_FILE_DESCRIPTOR_SET)
        .map_err(|err| format!("Failed to load bundled Warp protobuf descriptor: {err}"))
});

pub type WarpHistorySessionRow = ImportedHistorySessionRow;
pub type WarpHistorySessionPage = ImportedHistorySessionPage;
pub type WarpRecentPath = ImportedHistoryRecentPath;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct WarpConversationSummary {
    initial_query: String,
    title: String,
    initial_working_directory: Option<String>,
    is_unlisted_auto_code_diff: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct WarpConversationData {
    conversation_usage_metadata: Option<WarpConversationUsageMetadata>,
    parent_conversation_id: Option<String>,
    agent_name: Option<String>,
    is_remote_child: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct WarpConversationUsageMetadata {
    token_usage: Vec<WarpModelTokenUsage>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct WarpModelTokenUsage {
    model_id: String,
    #[serde(alias = "total_tokens")]
    warp_tokens: u32,
    byok_tokens: u32,
    custom_endpoint_tokens: u32,
}

#[derive(Debug, Clone)]
struct WarpConversationRecord {
    conversation_id: String,
    conversation_data_json: String,
    last_modified_at: String,
    summary_json: Option<String>,
    task_count: i64,
    task_bytes: i64,
}

#[derive(Debug, Clone, Default)]
struct WarpTaskAnalysis {
    chunks: Vec<ActivityChunk>,
    initial_query: Option<String>,
    root_description: Option<String>,
    model: Option<String>,
    created_at_ms: Option<i64>,
    updated_at_ms: Option<i64>,
    impact: ImportedHistoryImpactStats,
}

#[derive(Debug, Clone)]
struct OrderedMessage {
    task_index: usize,
    message_index: usize,
    timestamp_ms: Option<i64>,
    created_at: String,
    value: Value,
}

pub fn list_warp_history_sessions_paginated(
    conn: &mut Connection,
    limit: usize,
    offset: usize,
) -> Result<WarpHistorySessionPage, String> {
    sync_warp_history_cache(conn)?;
    imported_cache::query_imported_session_page_from_conn(conn, SOURCE_WARP, limit, offset)
}

pub fn list_warp_recent_paths(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<WarpRecentPath>, String> {
    sync_warp_history_cache(conn)?;
    imported_cache::query_imported_recent_paths_from_conn(conn, SOURCE_WARP, limit)
}

pub fn load_warp_history_for_session(session_id: &str) -> Result<Vec<ActivityChunk>, String> {
    let conversation_id = warp_conversation_id_from_session_id(session_id)?;
    let Some((conn, _db_path)) = open_warp_db()? else {
        return Ok(Vec::new());
    };
    let records = load_task_blobs(&conn, conversation_id)?;
    let fallback_ms = load_conversation_last_modified_ms(&conn, conversation_id)?.unwrap_or(0);
    Ok(analyze_task_blobs(session_id, &records, fallback_ms).chunks)
}

/// Candidate `warp.sqlite` locations used by both import and source detection.
pub fn warp_history_candidate_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let mut candidates = warp_db_candidate_paths_for_home(&home);
    if let Some(xdg_state_home) = env::var_os("XDG_STATE_HOME") {
        candidates.push(PathBuf::from(xdg_state_home).join("warp-terminal/warp.sqlite"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join("warp/Warp/data/warp.sqlite"));
    }
    if let Some(data_local) = dirs::data_local_dir() {
        candidates.push(data_local.join("warp/Warp/data/warp.sqlite"));
    }
    dedupe_paths(candidates)
}

#[cfg(test)]
#[path = "../history_tests.rs"]
mod tests;
