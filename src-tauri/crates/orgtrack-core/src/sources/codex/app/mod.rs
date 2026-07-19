//! Codex app event reader
//!
//! Reads Codex rollout JSONL files from `~/.codex/sessions/YYYY/MM/DD/` and
//! converts them into ORGII's canonical `ActivityChunk` shape. These rows are
//! imported history only: ORGII does not own the Codex process or write back to
//! Codex's local files.

// External names surfaced to the companion tests via their `use super::*`.
#[allow(unused_imports)]
use serde_json::{json, Value};
#[allow(unused_imports)]
use std::path::Path;
#[allow(unused_imports)]
use crate::sources::imported_history::{
    self,
    metadata::{ImportedHistoryDiscoveredRecord, ImportedHistoryImpactStats},
    paths as imported_paths, strip_orgii_exec_mode_bridge,
};

mod desktop_exec;
mod types;
mod discovery;
mod meta;
mod impact;
mod loading;
mod chunks;
mod normalize;
mod shell_read;
mod shell_search;
mod payload;
mod session_paths;

// Keep `super::` references in the moved item bodies resolving to the parent
// `codex` module.
pub(crate) use super::canonical_session_id;
pub(crate) use super::SESSION_PREFIX as CODEX_APP_SESSION_PREFIX;

// Re-export every submodule item into the `app` module scope so siblings (and
// `desktop_exec`, and the companion tests) resolve the same paths they did when
// this was a single file.
pub(crate) use chunks::*;
pub(crate) use discovery::*;
pub(crate) use impact::*;
pub(crate) use meta::*;
pub(crate) use normalize::*;
pub(crate) use payload::*;
pub(crate) use session_paths::*;
pub(crate) use shell_read::*;
pub(crate) use shell_search::*;
pub(crate) use types::*;

// Preserve the exact external/crate visibility of the items other crates and
// modules reach at `...::sources::codex::app::<item>`.
pub use discovery::{
    list_codex_app_recent_paths, list_codex_app_sessions_paginated, load_codex_app_for_session,
    resolve_codex_transcript_for_thread_id_near_path,
};
pub use loading::load_codex_app_from_path;
pub use types::{
    CodexAppRecentPath, CodexAppSessionPage, CodexAppSessionRow, CodexTranscriptLocator,
};

#[cfg(test)]
#[path = "../app_tests.rs"]
mod tests;
