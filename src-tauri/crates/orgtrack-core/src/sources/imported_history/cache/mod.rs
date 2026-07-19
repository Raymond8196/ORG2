use super::metadata::ImportedHistoryImpactStats;
use super::{row_from_input, ImportedHistoryRowInput, ImportedHistorySessionRow};

mod lookups;
mod query;
mod signatures;
mod write;

pub use lookups::*;
pub use query::*;
pub use signatures::*;
pub use write::*;

#[derive(Debug, Clone)]
pub struct ImportedHistoryCachedSession {
    pub source_session_id: String,
    pub session_id: String,
    pub source_path: String,
    pub source_record_key: String,
    pub source_mtime_ms: i64,
    pub source_size_bytes: i64,
    pub source_fingerprint: String,
    pub parser_version: i64,
    pub name: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub repo_path: Option<String>,
    pub branch: Option<String>,
    pub impact: ImportedHistoryImpactStats,
    pub listable: bool,
    pub source_metadata_json: Option<String>,
    pub parent_session_id: Option<String>,
}

impl ImportedHistoryCachedSession {
    pub fn to_row(&self) -> ImportedHistorySessionRow {
        row_from_input(ImportedHistoryRowInput {
            session_id: self.session_id.clone(),
            name: self.name.clone(),
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
            model: self.model.clone(),
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            repo_path: self.repo_path.clone(),
            storage_path: Some(self.source_path.clone()),
            branch: self.branch.clone(),
            files_changed: self.impact.files_changed,
            lines_added: self.impact.lines_added,
            lines_removed: self.impact.lines_removed,
            touched_files: self.impact.touched_files.clone(),
            parent_session_id: self.parent_session_id.clone(),
        })
    }
}

#[cfg(test)]
#[path = "../cache_tests.rs"]
mod tests;
