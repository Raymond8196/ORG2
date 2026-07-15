//! External hook payload adapters for session provenance.
//!
//! Vendor payloads are accepted only at this boundary and immediately reduced
//! to [`ResourceInteractionEnvelopeV1`]. Raw tool responses, prompts, commands,
//! and file contents are never copied into the envelope.

use chrono::{SecondsFormat, Utc};
use serde_json::Value;
use std::path::Path;

use crate::canonical::{
    AttributionPrecision, ResourceAction, ResourceInteractionEnvelopeV1,
    ResourceInteractionOutcome, SessionActorLifecycleEnvelopeV1, SessionActorLifecyclePhase,
    RESOURCE_INTERACTION_SCHEMA_VERSION, SESSION_ACTOR_SCHEMA_VERSION,
};
use crate::resource_interaction::{explicit_file_paths, file_interactions_from_tool};
use crate::sources::imported_history::metadata::{
    SOURCE_CLAUDE_CODE, SOURCE_CODEX_APP, SOURCE_CURSOR_IDE,
};

const MAX_RESOURCE_INTERACTIONS_PER_HOOK: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookSource {
    ClaudeCode,
    Codex,
    Cursor,
}

impl HookSource {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            SOURCE_CLAUDE_CODE | "claude" => Ok(Self::ClaudeCode),
            SOURCE_CODEX_APP | "codex" => Ok(Self::Codex),
            SOURCE_CURSOR_IDE | "cursor" => Ok(Self::Cursor),
            other => Err(format!(
                "Unsupported session-provenance hook source: {other}"
            )),
        }
    }

    pub fn as_source_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => SOURCE_CLAUDE_CODE,
            Self::Codex => SOURCE_CODEX_APP,
            Self::Cursor => SOURCE_CURSOR_IDE,
        }
    }

    fn canonical_session_id(self, source_session_id: &str, payload: &Value) -> String {
        match self {
            Self::ClaudeCode => {
                crate::sources::claude_code::canonical_session_id(source_session_id)
            }
            Self::Codex => string_field(payload, &["transcript_path", "transcriptPath"])
                .as_deref()
                .and_then(transcript_file_stem)
                .map(crate::sources::codex::canonical_session_id)
                .unwrap_or_else(|| crate::sources::codex::canonical_session_id(source_session_id)),
            Self::Cursor => crate::sources::cursor_ide::canonical_session_id(source_session_id),
        }
    }

    fn canonical_lifecycle_session_id(self, source_session_id: &str, payload: &Value) -> String {
        if self != Self::Codex {
            return self.canonical_session_id(source_session_id, payload);
        }
        string_field(payload, &["transcript_path", "transcriptPath"])
            .as_deref()
            .and_then(transcript_file_stem)
            // Real Codex SubagentStart payloads point `transcript_path` at
            // the child rollout even though `session_id` is the parent. Only
            // trust the common path as the parent locator when its stem
            // actually carries the parent thread id.
            .filter(|file_stem| file_stem.ends_with(source_session_id))
            .map(crate::sources::codex::canonical_session_id)
            .unwrap_or_else(|| crate::sources::codex::canonical_session_id(source_session_id))
    }
}

pub fn normalize_hook_payload(
    source: HookSource,
    payload: &Value,
) -> Result<Vec<ResourceInteractionEnvelopeV1>, String> {
    let source_session_id = source_session_id(source, payload)
        .ok_or_else(|| "Hook payload is missing its session identifier".to_string())?;
    let cwd = string_field(payload, &["cwd", "workspace_path", "workspacePath"])
        .or_else(|| first_string_array_item(payload, &["workspace_roots", "workspaceRoots"]));
    let turn_id = string_field(payload, &["turn_id", "generation_id", "generationId"]);
    let actor_id = string_field(payload, &["agent_id", "subagent_id", "subagentId"]);
    let hook_event_name =
        string_field(payload, &["hook_event_name", "hookEventName", "event"]).unwrap_or_default();
    let outcome = if hook_event_name.to_ascii_lowercase().contains("failure") {
        ResourceInteractionOutcome::Failed
    } else {
        ResourceInteractionOutcome::Succeeded
    };
    let occurred_at = string_field(payload, &["timestamp", "occurred_at", "occurredAt"])
        .and_then(|timestamp| normalize_rfc3339(&timestamp))
        .unwrap_or_else(now_rfc3339);

    let mut path_actions = if hook_event_name.eq_ignore_ascii_case("subagentStop") {
        modified_file_actions(payload)
    } else {
        tool_path_actions(source, payload)
    };
    path_actions.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.as_str().cmp(right.1.as_str()))
    });
    path_actions.dedup();
    // One vendor callback must not be able to turn a bounded hook payload
    // into an unbounded number of spool files and Git resolver subprocesses.
    path_actions.truncate(MAX_RESOURCE_INTERACTIONS_PER_HOOK);
    if path_actions.is_empty() {
        return Ok(Vec::new());
    }
    let cwd = cwd.ok_or_else(|| {
        "Hook payload with file interactions is missing its workspace path".to_string()
    })?;

    let base_source_event_id = string_field(
        payload,
        &[
            "tool_use_id",
            "toolUseId",
            "event_id",
            "eventId",
            "generation_id",
            "generationId",
        ],
    );
    let session_id = source.canonical_session_id(&source_session_id, payload);
    let precision = if actor_id.is_some() {
        AttributionPrecision::Exact
    } else {
        AttributionPrecision::SessionOnly
    };

    Ok(path_actions
        .into_iter()
        .map(|(file_path, action)| {
            let source_event_id = base_source_event_id
                .as_ref()
                .map(|base| format!("{base}:{}:{file_path}", action.as_str()));
            ResourceInteractionEnvelopeV1 {
                schema_version: RESOURCE_INTERACTION_SCHEMA_VERSION,
                source: source.as_source_str().to_string(),
                source_session_id: source_session_id.clone(),
                session_id: session_id.clone(),
                source_event_id,
                turn_id: turn_id.clone(),
                actor_id: actor_id.clone(),
                cwd: cwd.clone(),
                file_path,
                action,
                outcome,
                occurred_at: occurred_at.clone(),
                attribution_precision: precision,
            }
        })
        .collect())
}

/// Reduce a vendor subagent lifecycle hook to local-only session metadata.
/// Raw prompts, assistant messages, tool payloads, and transcript contents are
/// never copied across this boundary.
pub fn normalize_actor_lifecycle_payload(
    source: HookSource,
    payload: &Value,
) -> Result<Option<SessionActorLifecycleEnvelopeV1>, String> {
    let Some(phase) = hook_lifecycle_phase(payload) else {
        return Ok(None);
    };
    let source_session_id = if source == HookSource::Cursor {
        string_field(payload, &["parent_conversation_id", "parentConversationId"])
            .or_else(|| source_session_id(source, payload))
    } else {
        source_session_id(source, payload)
    }
    .ok_or_else(|| "Hook payload is missing its session identifier".to_string())?;
    let Some(actor_id) = string_field(payload, &["agent_id", "subagent_id", "subagentId"]) else {
        // Some vendors emit a coarse subagent-stop event with only modified
        // files. Keep those resource observations, but do not invent an actor
        // identity or transcript relationship.
        return Ok(None);
    };
    let cwd = string_field(payload, &["cwd", "workspace_path", "workspacePath"])
        .or_else(|| first_string_array_item(payload, &["workspace_roots", "workspaceRoots"]))
        .ok_or_else(|| "Actor lifecycle hook is missing its workspace path".to_string())?;
    let occurred_at = string_field(payload, &["timestamp", "occurred_at", "occurredAt"])
        .and_then(|timestamp| normalize_rfc3339(&timestamp))
        .unwrap_or_else(now_rfc3339);
    let transcript_path = string_field(payload, &["agent_transcript_path", "agentTranscriptPath"]);
    let session_id = source.canonical_lifecycle_session_id(&source_session_id, payload);
    let envelope = SessionActorLifecycleEnvelopeV1 {
        schema_version: SESSION_ACTOR_SCHEMA_VERSION,
        source: source.as_source_str().to_string(),
        source_session_id,
        session_id,
        turn_id: string_field(payload, &["turn_id", "generation_id", "generationId"]),
        actor_id,
        actor_type: string_field(
            payload,
            &["agent_type", "agentType", "subagent_type", "subagentType"],
        ),
        phase,
        occurred_at,
        cwd,
        transcript_path,
    };
    envelope.validate().map_err(|err| err.to_string())?;
    Ok(Some(envelope))
}

fn hook_lifecycle_phase(payload: &Value) -> Option<SessionActorLifecyclePhase> {
    let event = string_field(payload, &["hook_event_name", "hookEventName", "event"])?;
    let normalized = event
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "subagentstart" => Some(SessionActorLifecyclePhase::Started),
        "subagentstop" => Some(SessionActorLifecyclePhase::Stopped),
        _ => None,
    }
}

fn transcript_file_stem(path: &str) -> Option<&str> {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn source_session_id(source: HookSource, payload: &Value) -> Option<String> {
    match source {
        HookSource::ClaudeCode | HookSource::Codex => {
            string_field(payload, &["session_id", "sessionId"])
        }
        HookSource::Cursor => string_field(
            payload,
            &[
                "conversation_id",
                "conversationId",
                "session_id",
                "sessionId",
            ],
        ),
    }
}

fn tool_path_actions(source: HookSource, payload: &Value) -> Vec<(String, ResourceAction)> {
    let tool_name = string_field(payload, &["tool_name", "toolName"]).unwrap_or_default();
    let tool_input = payload
        .get("tool_input")
        .or_else(|| payload.get("toolInput"))
        .unwrap_or(&Value::Null);

    let explicit = file_interactions_from_tool(&tool_name, tool_input, None)
        .into_iter()
        .map(|interaction| (interaction.file_path, interaction.action))
        .collect::<Vec<_>>();
    if !explicit.is_empty() {
        return explicit;
    }

    if matches!(source, HookSource::Codex | HookSource::Cursor) {
        return shell_path_actions(&tool_name, tool_input);
    }
    Vec::new()
}

/// Reuse the transcript importer's conservative shell classifier at the hook
/// boundary. It recognizes only read-only file commands (`cat`, bounded
/// `sed`, `head`, `tail`) and code-search commands. The raw command is used
/// transiently for classification and is never copied into the envelope.
fn shell_path_actions(tool_name: &str, tool_input: &Value) -> Vec<(String, ResourceAction)> {
    crate::sources::codex::app::normalize_codex_tool_calls(tool_name, tool_input.clone())
        .into_iter()
        .flat_map(|(canonical_name, args)| {
            let action = match canonical_name.as_str() {
                crate::sources::imported_history::FUNCTION_READ_FILE => ResourceAction::Read,
                crate::sources::imported_history::FUNCTION_CODE_SEARCH
                | crate::sources::imported_history::FUNCTION_GLOB_FILE_SEARCH => {
                    ResourceAction::Search
                }
                crate::sources::imported_history::FUNCTION_EDIT_FILE => ResourceAction::Write,
                _ => return Vec::new(),
            };
            explicit_file_paths(&args)
                .into_iter()
                .map(|path| (path, action))
                .collect()
        })
        .collect()
}

fn modified_file_actions(payload: &Value) -> Vec<(String, ResourceAction)> {
    payload
        .get("modified_files")
        .or_else(|| payload.get("modifiedFiles"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .map(|path| (path.to_string(), ResourceAction::Write))
        .collect()
}

fn string_field(value: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        value
            .get(*field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|field| !field.is_empty())
            .map(str::to_string)
    })
}

fn first_string_array_item(value: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        value
            .get(*field)
            .and_then(Value::as_array)
            .and_then(|items| items.iter().find_map(Value::as_str))
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
    })
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn normalize_rfc3339(timestamp: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_read_keeps_exact_subagent_attribution_without_raw_output() {
        let envelopes = normalize_hook_payload(
            HookSource::ClaudeCode,
            &json!({
                "session_id": "session-1",
                "cwd": "/repo",
                "hook_event_name": "PostToolUse",
                "tool_name": "Read",
                "tool_use_id": "tool-1",
                "agent_id": "agent-1",
                "tool_input": {"file_path": "/repo/src/lib.rs"},
                "tool_response": {"content": "secret file contents"}
            }),
        )
        .expect("normalize Claude hook");

        assert_eq!(envelopes.len(), 1);
        assert_eq!(envelopes[0].session_id, "claudecodeapp-session-1");
        assert_eq!(envelopes[0].actor_id.as_deref(), Some("agent-1"));
        assert_eq!(envelopes[0].action, ResourceAction::Read);
        assert_eq!(
            envelopes[0].attribution_precision,
            AttributionPrecision::Exact
        );
        let serialized = serde_json::to_string(&envelopes[0]).expect("serialize envelope");
        assert!(!serialized.contains("secret file contents"));
    }

    #[test]
    fn codex_apply_patch_preserves_per_file_actions() {
        let envelopes = normalize_hook_payload(
            HookSource::Codex,
            &json!({
                "session_id": "session-2",
                "turn_id": "turn-2",
                "cwd": "/repo",
                "hook_event_name": "PostToolUse",
                "tool_name": "apply_patch",
                "tool_use_id": "tool-2",
                "tool_input": {
                    "command": "*** Begin Patch\n*** Add File: src/new.rs\n+x\n*** Delete File: src/old.rs\n*** End Patch"
                }
            }),
        )
        .expect("normalize Codex hook");

        assert_eq!(envelopes.len(), 2);
        assert_eq!(envelopes[0].session_id, "codexapp-session-2");
        assert_eq!(envelopes[0].action, ResourceAction::Create);
        assert_eq!(envelopes[1].action, ResourceAction::Delete);
        assert_eq!(
            envelopes[0].attribution_precision,
            AttributionPrecision::SessionOnly
        );
    }

    #[test]
    fn codex_uses_parent_transcript_stem_as_loadable_root_session() {
        let envelopes = normalize_hook_payload(
            HookSource::Codex,
            &json!({
                "session_id": "019f-parent-thread",
                "transcript_path": "/Users/me/.codex/sessions/2026/07/14/rollout-2026-07-14T10-00-00-019f-parent-thread.jsonl",
                "cwd": "/repo",
                "hook_event_name": "PostToolUse",
                "tool_name": "Read",
                "tool_use_id": "tool-1",
                "tool_input": {"file_path": "src/lib.rs"}
            }),
        )
        .expect("normalize Codex hook");

        assert_eq!(
            envelopes[0].session_id,
            "codexapp-rollout-2026-07-14T10-00-00-019f-parent-thread"
        );
        assert_eq!(envelopes[0].source_session_id, "019f-parent-thread");
    }

    #[test]
    fn codex_subagent_stop_keeps_only_lifecycle_and_child_locator_metadata() {
        let payload = json!({
            "session_id": "019f-parent-thread",
            "turn_id": "turn-1",
            "transcript_path": "/Users/me/.codex/sessions/parent-rollout-019f-parent-thread.jsonl",
            "cwd": "/repo",
            "hook_event_name": "SubagentStop",
            "agent_id": "agent-1",
            "agent_type": "explorer",
            "agent_transcript_path": "/Users/me/.codex/sessions/child-rollout.jsonl",
            "last_assistant_message": "private answer"
        });
        let lifecycle = normalize_actor_lifecycle_payload(HookSource::Codex, &payload)
            .expect("normalize lifecycle")
            .expect("lifecycle envelope");

        assert_eq!(
            lifecycle.session_id,
            "codexapp-parent-rollout-019f-parent-thread"
        );
        assert_eq!(lifecycle.actor_id, "agent-1");
        assert_eq!(lifecycle.actor_type.as_deref(), Some("explorer"));
        assert_eq!(lifecycle.phase, SessionActorLifecyclePhase::Stopped);
        assert_eq!(
            lifecycle.transcript_path.as_deref(),
            Some("/Users/me/.codex/sessions/child-rollout.jsonl")
        );
        let serialized = serde_json::to_string(&lifecycle).expect("serialize lifecycle");
        assert!(!serialized.contains("private answer"));
    }

    #[test]
    fn codex_subagent_start_does_not_mistake_child_transcript_for_parent() {
        let lifecycle = normalize_actor_lifecycle_payload(
            HookSource::Codex,
            &json!({
                "session_id": "019f-parent-thread",
                "turn_id": "turn-1",
                "transcript_path": "/Users/me/.codex/sessions/child-rollout-019f-child-thread.jsonl",
                "cwd": "/repo",
                "hook_event_name": "SubagentStart",
                "agent_id": "019f-child-thread",
                "agent_type": "default"
            }),
        )
        .expect("normalize lifecycle")
        .expect("lifecycle envelope");

        assert_eq!(lifecycle.session_id, "codexapp-019f-parent-thread");
        assert_eq!(lifecycle.phase, SessionActorLifecyclePhase::Started);
    }

    #[test]
    fn cursor_subagent_start_preserves_parent_and_actor_identity() {
        let lifecycle = normalize_actor_lifecycle_payload(
            HookSource::Cursor,
            &json!({
                "conversation_id": "cursor-current-context",
                "generation_id": "generation-1",
                "workspace_roots": ["/repo"],
                "hook_event_name": "subagentStart",
                "subagent_id": "cursor-child-1",
                "subagent_type": "explore",
                "parent_conversation_id": "cursor-parent-1",
                "task": "private task description"
            }),
        )
        .expect("normalize Cursor lifecycle")
        .expect("Cursor lifecycle envelope");

        assert_eq!(lifecycle.source_session_id, "cursor-parent-1");
        assert_eq!(lifecycle.session_id, "cursoride-cursor-parent-1");
        assert_eq!(lifecycle.actor_id, "cursor-child-1");
        assert_eq!(lifecycle.actor_type.as_deref(), Some("explore"));
        assert_eq!(lifecycle.phase, SessionActorLifecyclePhase::Started);
        let serialized = serde_json::to_string(&lifecycle).expect("serialize lifecycle");
        assert!(!serialized.contains("private task description"));
    }

    #[test]
    fn codex_exec_command_records_read_path_without_retaining_command() {
        let envelopes = normalize_hook_payload(
            HookSource::Codex,
            &json!({
                "session_id": "session-read",
                "turn_id": "turn-read",
                "cwd": "/repo",
                "hook_event_name": "PostToolUse",
                "tool_name": "exec_command",
                "tool_use_id": "tool-read",
                "tool_input": {"cmd": "sed -n '1,20p' src/lib.rs"},
                "tool_response": {"output": "private source"}
            }),
        )
        .expect("normalize Codex shell read");

        assert_eq!(envelopes.len(), 1);
        assert_eq!(envelopes[0].file_path, "src/lib.rs");
        assert_eq!(envelopes[0].action, ResourceAction::Read);
        let serialized = serde_json::to_string(&envelopes).expect("serialize envelopes");
        assert!(!serialized.contains("sed -n"));
        assert!(!serialized.contains("private source"));
    }

    #[test]
    fn cursor_subagent_stop_uses_modified_files() {
        let envelopes = normalize_hook_payload(
            HookSource::Cursor,
            &json!({
                "conversation_id": "conversation-1",
                "generation_id": "generation-1",
                "workspace_roots": ["/repo"],
                "hook_event_name": "subagentStop",
                "modified_files": ["src/a.rs", "src/b.rs"]
            }),
        )
        .expect("normalize Cursor hook");

        assert_eq!(envelopes.len(), 2);
        assert_eq!(envelopes[0].session_id, "cursoride-conversation-1");
        assert_eq!(envelopes[0].cwd, "/repo");
        assert_eq!(envelopes[0].actor_id, None);
        assert_eq!(
            envelopes[0].attribution_precision,
            AttributionPrecision::SessionOnly
        );
        assert!(envelopes
            .iter()
            .all(|envelope| envelope.action == ResourceAction::Write));
    }

    #[test]
    fn cursor_post_tool_use_matches_live_payload_without_retaining_private_fields() {
        let envelopes = normalize_hook_payload(
            HookSource::Cursor,
            &json!({
                "conversation_id": "conversation-live",
                "generation_id": "generation-live",
                "workspace_roots": ["/repo"],
                "hook_event_name": "postToolUse",
                "tool_name": "Read",
                "tool_use_id": "tool-live",
                "tool_input": {"file_path": "src/lib.rs"},
                "tool_output": "private file contents",
                "user_email": "private@example.com"
            }),
        )
        .expect("normalize live Cursor hook shape");

        assert_eq!(envelopes.len(), 1);
        assert_eq!(envelopes[0].session_id, "cursoride-conversation-live");
        assert_eq!(envelopes[0].turn_id.as_deref(), Some("generation-live"));
        assert_eq!(
            envelopes[0].source_event_id.as_deref(),
            Some("tool-live:read:src/lib.rs")
        );
        assert_eq!(envelopes[0].cwd, "/repo");
        assert_eq!(envelopes[0].file_path, "src/lib.rs");
        assert_eq!(envelopes[0].action, ResourceAction::Read);
        assert_eq!(
            envelopes[0].attribution_precision,
            AttributionPrecision::SessionOnly
        );
        let serialized = serde_json::to_string(&envelopes).expect("serialize envelopes");
        assert!(!serialized.contains("private file contents"));
        assert!(!serialized.contains("private@example.com"));
    }

    #[test]
    fn vendor_timestamps_are_normalized_to_utc() {
        let envelopes = normalize_hook_payload(
            HookSource::ClaudeCode,
            &json!({
                "session_id": "session-3",
                "cwd": "/repo",
                "timestamp": "2026-07-14T10:00:00+02:00",
                "tool_name": "Read",
                "tool_input": {"file_path": "src/lib.rs"}
            }),
        )
        .expect("normalize timestamp");
        assert_eq!(envelopes[0].occurred_at, "2026-07-14T08:00:00.000Z");
    }

    #[test]
    fn file_interactions_without_a_workspace_are_rejected() {
        let error = normalize_hook_payload(
            HookSource::ClaudeCode,
            &json!({
                "session_id": "session-4",
                "tool_name": "Read",
                "tool_input": {"file_path": "src/lib.rs"}
            }),
        )
        .expect_err("relative paths without a workspace must not be attributed");
        assert!(error.contains("workspace path"));
    }

    #[test]
    fn one_hook_payload_has_a_bounded_interaction_fanout() {
        let modified_files = (0..=MAX_RESOURCE_INTERACTIONS_PER_HOOK)
            .map(|index| format!("src/generated-{index}.rs"))
            .collect::<Vec<_>>();
        let envelopes = normalize_hook_payload(
            HookSource::Cursor,
            &json!({
                "conversation_id": "bounded-fanout",
                "workspace_roots": ["/repo"],
                "hook_event_name": "subagentStop",
                "modified_files": modified_files
            }),
        )
        .expect("normalize bounded hook payload");

        assert_eq!(envelopes.len(), MAX_RESOURCE_INTERACTIONS_PER_HOOK);
    }
}
