//! Best-effort tool-trajectory enrichment from Qoder's per-launch logs.
//!
//! Qoder's durable transcript (`conversation-history/*.jsonl`) carries only
//! user/assistant text — tool calls stream live over ACP and are never written
//! to a unified store. What survives on disk, per app launch:
//!
//!   - `questWindow/agent.log` — ACP `tool_call` events (id + timestamp, no
//!     payload), `SubAgentService` registrations (subagent type, prompt,
//!     parent session id), and `ToolInvokeHandlerContribution` lines carrying
//!     tool name + args for locally-dispatched tools (`read_file`, …).
//!   - `questWindow/exthost/output_logging_*/1-Qoder.log` — `ToolInvoke :
//!     <name>` lines followed by the args JSON on the next line (terminal
//!     commands with their `cwd`, …).
//!   - `cache/projects/<proj>/agent-tools/<hash>/<hash>.txt` — spill files
//!     holding oversized tool outputs; the agent reads them back via
//!     `read_file`, which is how their content re-enters the trajectory.
//!
//! Only events that carry real payload are emitted (subagent spawns and tool
//! invocations with args) — bare ACP `tool_call` ids alone render as empty
//! cards and are used here solely for activity windows and call-id pairing.
//!
//! Invoke lines carry no session id, so attribution is by **content first**
//! (args paths inside the session's workspace or project cache dir), falling
//! back to the session's activity window when the paths say nothing — and
//! dropped when several sessions' windows overlap the timestamp. Logs rotate
//! per launch, so old sessions simply get no enrichment. Any failure degrades
//! to the unenriched transcript, never an error.

use serde_json::Value;

// Referenced by the reader submodules and tests via `use super::*`.
#[cfg(test)]
use core_types::activity::ActivityChunk;
#[cfg(test)]
use std::collections::HashMap;

mod enrich;
mod parse;
mod snapshots;

pub(super) use enrich::*;
pub(super) use snapshots::*;
use parse::*;

const ACP_PROGRESS_MARKER: &str = "[ChatSessionService] ACP progress: ";
const SUBAGENT_MARKER: &str = "[SubAgentService] Registered SubAgent: ";
const TOOL_INVOKE_MARKER: &str = "[ToolInvokeHandlerContribution] Tool invoke request: ";
const EXTHOST_INVOKE_MARKER: &str = " ToolInvoke : ";
const FILE_CHANGE_MARKER: &str = "[FileChangeTracking] ";
const SESSION_ID_SUFFIX: &str = ".session.execution";
/// Pad around a session's first/last ACP event when window-attributing
/// invoke lines with no content signal.
const WINDOW_PAD_MS: i64 = 2_000;
/// An invoke usually trails its ACP `tool_call` event by well under a second;
/// pair them within this window to recover the call id.
const CALL_ID_PAIR_MS: i64 = 2_500;

#[derive(Debug, Clone)]
enum LogEvent {
    /// Any ACP progress line; `tool_call_id` set only for `type=tool_call`.
    Acp {
        ts_ms: i64,
        session_task_id: String,
        tool_call_id: Option<String>,
    },
    /// `Registered SubAgent: {parentToolCallId, parentSessionId, agentType, …}`
    Subagent {
        ts_ms: i64,
        session_task_id: String,
        tool_call_id: String,
        agent_type: String,
        description: String,
        prompt: String,
    },
    /// A tool invocation with name + args — carries NO session id.
    ToolInvoke { ts_ms: i64, name: String, args: Value },
    /// `[FileChangeTracking] <path> | source=agent | session=<taskDir>, … | Agent <op>` —
    /// an agent file edit, carrying the session as the truncated dir name.
    FileEdit {
        ts_ms: i64,
        session_dir_name: String,
        path: String,
        operation: String,
    },
}

/// Which session an invoke's args point at, judged purely by its paths.
#[derive(Debug, PartialEq)]
enum ContentSignal {
    Ours,
    Theirs,
    Silent,
}

#[cfg(test)]
#[path = "../log_enrichment_tests.rs"]
mod tests;
