//! Process-global snapshot of connected MCP servers' `InitializeResult.instructions`.
//!
//! MCP servers use the `instructions` field of the initialize handshake to
//! tell the model HOW their tools should be used (batching guidance, safety
//! rules, workflow ordering). The `McpManager` publishes each server's
//! instructions here on connect and retracts them on disconnect; the
//! `mcp_instructions` prompt section reads [`snapshot`] synchronously when
//! assembling the system prompt.
//!
//! A global is used (instead of threading through `SystemPromptConfig`)
//! because prompt sections render synchronously while the manager lives
//! behind the async Tauri app state — the same pattern `flow_awareness`
//! uses. Per-session visibility is enforced at render time by matching
//! servers against the session's registered `mcp__<server>__*` tools, so a
//! server disabled for one session never leaks its instructions there.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

/// Cap per server. Servers occasionally ship multi-KB essays; this keeps
/// the prompt section bounded even with several chatty servers connected.
pub(crate) const MAX_MCP_INSTRUCTIONS_CHARS: usize = 1000;

fn store() -> &'static RwLock<HashMap<String, String>> {
    static STORE: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Trim + cap raw handshake instructions. `None` when there is nothing
/// meaningful to publish (absent, empty, or whitespace-only).
pub(crate) fn normalize(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(super::bridge::truncate_description(
        trimmed,
        MAX_MCP_INSTRUCTIONS_CHARS,
    ))
}

/// Publish (or retract, when `None`) a server's instructions.
pub(crate) fn publish(server: &str, instructions: Option<&str>) {
    // A poisoned lock only means another thread panicked mid-write; the
    // map itself is still coherent (String inserts are not torn).
    let mut guard = store().write().unwrap_or_else(|p| p.into_inner());
    match instructions {
        Some(text) => {
            guard.insert(server.to_string(), text.to_string());
        }
        None => {
            guard.remove(server);
        }
    }
}

/// Retract a server's instructions (disconnect / shutdown).
pub(crate) fn retract(server: &str) {
    store()
        .write()
        .unwrap_or_else(|p| p.into_inner())
        .remove(server);
}

/// All published `(server, instructions)` pairs, sorted by server name so
/// the rendered prompt section is deterministic across assemblies.
pub(crate) fn snapshot() -> Vec<(String, String)> {
    let guard = store().read().unwrap_or_else(|p| p.into_inner());
    let mut entries: Vec<(String, String)> = guard
        .iter()
        .map(|(name, text)| (name.clone(), text.clone()))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

#[cfg(test)]
mod tests {
    // The store is process-global and tests run in parallel, so every test
    // uses unique server names and asserts membership rather than full
    // snapshot equality.
    use super::*;

    #[test]
    fn normalize_drops_empty_and_whitespace() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("   \n\t "), None);
    }

    #[test]
    fn normalize_trims_and_passes_short_text_through() {
        assert_eq!(
            normalize("  use tool X first  ").as_deref(),
            Some("use tool X first")
        );
    }

    #[test]
    fn normalize_caps_long_text_with_marker() {
        let long = "x".repeat(MAX_MCP_INSTRUCTIONS_CHARS + 500);
        let capped = normalize(&long).expect("non-empty");
        assert!(capped.ends_with(super::super::bridge::TRUNCATION_MARKER));
        assert!(capped.chars().count() < long.chars().count());
    }

    #[test]
    fn publish_snapshot_retract_round_trip() {
        publish("instr_test_alpha", Some("alpha rules"));
        assert!(snapshot()
            .iter()
            .any(|(n, t)| n == "instr_test_alpha" && t == "alpha rules"));

        publish("instr_test_alpha", None);
        assert!(!snapshot().iter().any(|(n, _)| n == "instr_test_alpha"));
    }

    #[test]
    fn retract_removes_entry() {
        publish("instr_test_beta", Some("beta rules"));
        retract("instr_test_beta");
        assert!(!snapshot().iter().any(|(n, _)| n == "instr_test_beta"));
    }

    #[test]
    fn snapshot_is_sorted_by_server_name() {
        publish("instr_test_sort_b", Some("b"));
        publish("instr_test_sort_a", Some("a"));
        let snap = snapshot();
        let pos_a = snap.iter().position(|(n, _)| n == "instr_test_sort_a");
        let pos_b = snap.iter().position(|(n, _)| n == "instr_test_sort_b");
        assert!(pos_a.expect("a present") < pos_b.expect("b present"));
        retract("instr_test_sort_a");
        retract("instr_test_sort_b");
    }
}
