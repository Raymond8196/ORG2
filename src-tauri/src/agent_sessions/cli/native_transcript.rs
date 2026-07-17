//! Native-transcript capability map for managed CLI sessions.
//!
//! A managed session whose agent has a binding here persists NO transcript
//! chunks of its own (`code_sessions.transcript_source = 'native'`): the CLI
//! writes its native store (inside the ORGII profile dirs, which the
//! imported-history readers scan as extra discovery roots) and replay routes
//! through `imported_history::load_activity_chunks_for_session` keyed by
//! `<imported_prefix><cli_session_id>`. Agents without a binding keep the
//! legacy `code_session_chunks` path.

use key_vault::key_store::ModelType;
use orgtrack_core::sources::imported_history::metadata::{
    SOURCE_CLAUDE_CODE, SOURCE_CODEX_APP, SOURCE_OPENCODE,
};

pub const TRANSCRIPT_SOURCE_CHUNKS: &str = "chunks";
pub const TRANSCRIPT_SOURCE_NATIVE: &str = "native";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeTranscriptBinding {
    /// Imported-history source id (`claude_code`, `codex_app`, ...).
    pub source: &'static str,
    /// Imported-history session-id prefix (`claudecodeapp-`, ...).
    pub imported_prefix: &'static str,
}

impl NativeTranscriptBinding {
    pub fn imported_session_id(&self, cli_session_id: &str) -> String {
        format!("{}{}", self.imported_prefix, cli_session_id)
    }
}

/// Which agents run in native-transcript mode. Only agents with BOTH a GUI
/// launch profile AND an imported-history reader qualify; CursorCli is
/// deliberately absent (the cursor-agent CLI writes `~/.cursor/chats/*`,
/// a different store than the IDE reader parses) until a `cursor_cli`
/// reader exists.
pub fn native_transcript_binding(agent: &ModelType) -> Option<NativeTranscriptBinding> {
    match agent {
        ModelType::ClaudeCode => Some(NativeTranscriptBinding {
            source: SOURCE_CLAUDE_CODE,
            imported_prefix: orgtrack_core::sources::claude_code::SESSION_PREFIX,
        }),
        ModelType::Codex => Some(NativeTranscriptBinding {
            source: SOURCE_CODEX_APP,
            imported_prefix: orgtrack_core::sources::codex::SESSION_PREFIX,
        }),
        ModelType::OpenCode => Some(NativeTranscriptBinding {
            source: SOURCE_OPENCODE,
            imported_prefix: orgtrack_core::sources::opencode::history::OPENCODE_SESSION_PREFIX,
        }),
        _ => None,
    }
}

/// Rollout gate for M2: which of the bound agents actually CREATE sessions in
/// native mode today. Codex/OpenCode keep legacy chunks until their discovery
/// roots and replay paths are verified end-to-end (M3); their bindings above
/// already serve dedup and live-status id mapping.
pub fn native_transcript_enabled(agent: &ModelType) -> bool {
    matches!(agent, ModelType::ClaudeCode)
}

/// Managed session id → imported-history transcript id, when the session is
/// native-mode and a CLI-native id has been bound. Used by cross-provider
/// projections (turn metadata, exporter) to route a managed id into the
/// imported loaders. `None` = not a native-mode managed session (or no
/// binding yet) — callers fall through to their legacy path.
pub fn imported_transcript_id_for_managed_session(session_id: &str) -> Option<String> {
    let session = super::persistence::get_session(session_id).ok().flatten()?;
    if session.transcript_source != TRANSCRIPT_SOURCE_NATIVE {
        return None;
    }
    let agent = session
        .cli_agent_type
        .as_deref()
        .and_then(ModelType::from_str)?;
    let binding = native_transcript_binding(&agent)?;
    let cli_session_id = super::persistence::latest_native_transcript_id(session_id, binding.source)
        .ok()
        .flatten()
        .or(session.cli_session_id)?;
    Some(binding.imported_session_id(&cli_session_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_binding_builds_imported_ids() {
        let binding = native_transcript_binding(&ModelType::ClaudeCode).expect("binding");
        assert_eq!(binding.source, "claude_code");
        assert_eq!(
            binding.imported_session_id("abc-123"),
            "claudecodeapp-abc-123"
        );
    }

    #[test]
    fn only_claude_is_native_enabled_in_m2() {
        assert!(native_transcript_enabled(&ModelType::ClaudeCode));
        assert!(!native_transcript_enabled(&ModelType::Codex));
        assert!(!native_transcript_enabled(&ModelType::OpenCode));
        assert!(!native_transcript_enabled(&ModelType::CursorCli));
    }
}
