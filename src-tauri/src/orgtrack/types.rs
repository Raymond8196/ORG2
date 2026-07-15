pub use orgtrack_core::privacy::{
    OrgtrackTier, PrivacyConfig as OrgtrackConfig, RedactionPolicy as OrgtrackRedactionPolicy,
    ORGTRACK_DIR_NAME, ORGTRACK_SCHEMA_VERSION,
};
pub use orgtrack_core::repo_sync::types::*;

use std::collections::BTreeMap;

use serde::Serialize;

/// My Station projection of canonical resource interactions, grouped by
/// session for one file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSessionHistory {
    pub schema_version: u32,
    pub file_path: String,
    pub backfill: FileSessionHistoryBackfill,
    pub sessions: Vec<FileSessionHistorySession>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSessionHistoryBackfill {
    pub status: String,
    pub indexed_sessions: usize,
    pub total_sessions: usize,
    pub failed_sessions: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSessionHistorySession {
    pub session_id: String,
    pub session_label: String,
    pub source: String,
    pub workspace_path: Option<String>,
    pub first_interaction_at: String,
    pub last_interaction_at: String,
    pub interaction_count: usize,
    pub action_counts: BTreeMap<String, usize>,
    pub capture_methods: Vec<String>,
    pub attribution_precision: String,
    pub participants: Vec<FileSessionHistoryParticipant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSessionHistoryParticipant {
    pub entry_id: String,
    /// Loadable transcript target. For a resolved subagent this is the child
    /// session; otherwise it falls back to the root session.
    pub session_id: String,
    pub parent_session_id: Option<String>,
    pub session_label: String,
    pub participant_kind: String,
    pub actor_id: Option<String>,
    pub actor_label: Option<String>,
    pub first_interaction_at: String,
    pub last_interaction_at: String,
    pub interaction_count: usize,
    pub action_counts: BTreeMap<String, usize>,
    pub actor_ids: Vec<String>,
    pub capture_methods: Vec<String>,
    pub attribution_precision: String,
}
