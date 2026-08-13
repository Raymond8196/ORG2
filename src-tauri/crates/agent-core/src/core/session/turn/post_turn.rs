//! Post-turn memory/evolution dispatch.
//!
//! The turn path submits lightweight jobs to the process-wide memory
//! coordinator. The coordinator owns admission, per-session coalescing,
//! deadlines and cancellation. Full transcripts are loaded from the canonical
//! message store only after a job obtains the global memory permit.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tracing::info;

use super::super::persistence as unified_persistence;
use crate::config::ReliabilityConfig;
use crate::memory::background::{
    bridge_cancel_flag, memory_job_is_enabled, submit_memory_job, MemoryJob, MemoryJobKind,
    MemoryJobOutcome,
};
use crate::memory::workspace_memory::auto_dream::{self as auto_dream, AutoDreamState};
use crate::memory::workspace_memory::extract::{self as extract_memories, ExtractMemoriesState};
use crate::model_context::session_memory::{self, SessionMemoryConfig, SessionMemoryState};
use crate::providers::LLMProvider;
use crate::session::workspace::SessionWorkspace;
use crate::tools::registry::ToolRegistry;
use core_types::providers::NativeHarnessType;

const SESSION_MEMORY_TIMEOUT: Duration = Duration::from_secs(60);
const WORKSPACE_EXTRACTION_TIMEOUT: Duration = Duration::from_secs(180);
const AUTO_DREAM_TIMEOUT: Duration = Duration::from_secs(300);
const MEMORY_TRANSCRIPT_MAX_BYTES: usize = 512 * 1024;

#[derive(Clone)]
pub(super) struct ForkProviderSpec {
    pub model: String,
    pub account_id: Option<String>,
    pub reliability: ReliabilityConfig,
    pub native_harness_type: Option<NativeHarnessType>,
    pub workspace: SessionWorkspace,
}

async fn fresh_fork_provider(spec: &ForkProviderSpec) -> Result<Arc<dyn LLMProvider>, String> {
    crate::providers::factory::create_provider_with_native_harness_preflight(
        &spec.model,
        spec.account_id.as_deref(),
        &spec.reliability,
        spec.native_harness_type,
        Some(spec.workspace.clone()),
    )
    .await
    .map(Arc::from)
    .map_err(|err| format!("Failed to create fork provider: {err}"))
}

fn load_durable_history(session_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let messages = unified_persistence::load_llm_history_text_only(session_id)
        .map_err(|err| format!("Failed to load durable memory transcript: {err}"))?;
    Ok(bound_memory_transcript(
        messages,
        MEMORY_TRANSCRIPT_MAX_BYTES,
    ))
}

fn message_estimated_bytes(message: &serde_json::Value) -> usize {
    serde_json::to_vec(message).map_or(0, |encoded| encoded.len())
}

/// Keep a recent suffix under the memory-job input budget while preserving an
/// assistant tool-call row together with all immediately following tool rows.
/// An oversized newest group is kept intact: structural validity beats a hard
/// byte cut that would make every provider retry fail.
fn bound_memory_transcript(
    messages: Vec<serde_json::Value>,
    max_bytes: usize,
) -> Vec<serde_json::Value> {
    if messages.is_empty() || max_bytes == 0 {
        return messages;
    }

    let mut groups: Vec<Vec<serde_json::Value>> = Vec::new();
    for message in messages {
        let role = message.get("role").and_then(|value| value.as_str());
        if role == Some("tool") {
            if let Some(last) = groups.last_mut() {
                last.push(message);
                continue;
            }
        }
        groups.push(vec![message]);
    }

    let mut kept: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut used = 0usize;
    for group in groups.into_iter().rev() {
        let group_bytes = group.iter().map(message_estimated_bytes).sum::<usize>();
        if !kept.is_empty() && used.saturating_add(group_bytes) > max_bytes {
            break;
        }
        used = used.saturating_add(group_bytes);
        kept.push(group);
    }
    kept.reverse();
    kept.into_iter().flatten().collect()
}

// ── Session memory extraction (step 9b) ─────────────────────────────

pub(super) struct SessionMemoryExtractionInput<'a> {
    pub session_id: &'a str,
    pub agent_id: Option<String>,
    pub prompt_tokens: i64,
    pub tool_calls_count: u32,
    pub sm_state: Arc<Mutex<SessionMemoryState>>,
    pub sm_config: SessionMemoryConfig,
    pub fork_provider: ForkProviderSpec,
}

pub(super) fn spawn_session_memory_extraction(input: SessionMemoryExtractionInput<'_>) {
    let SessionMemoryExtractionInput {
        session_id,
        agent_id,
        prompt_tokens,
        tool_calls_count,
        sm_state,
        sm_config,
        fork_provider,
    } = input;
    let sid = session_id.to_string();
    let job_sid = sid.clone();
    let job_agent_id = agent_id.clone();
    let cleanup_state = Arc::clone(&sm_state);

    let job = MemoryJob::new(
        sid,
        agent_id,
        MemoryJobKind::SessionMemory,
        SESSION_MEMORY_TIMEOUT,
        move |cancel| async move {
            if let Some(agent_id) = job_agent_id.as_deref() {
                if !memory_job_is_enabled(agent_id, MemoryJobKind::SessionMemory) {
                    return Ok(());
                }
            }

            let messages = load_durable_history(&job_sid)?;
            let current_tokens = if prompt_tokens > 0 {
                prompt_tokens as usize
            } else {
                crate::model_context::tokenizer::count_messages_tokens(&messages)
            };
            let has_tool_calls = session_memory::last_turn_has_tool_calls(&messages);
            {
                let mut state = sm_state.lock().await;
                state.record_tool_calls(tool_calls_count as usize);
                if !session_memory::should_extract(
                    &state,
                    &sm_config,
                    current_tokens,
                    has_tool_calls,
                ) {
                    return Ok(());
                }
            }

            info!(
                session_id = %job_sid,
                current_tokens,
                "[memory_background] starting session-memory extraction"
            );
            let provider = fresh_fork_provider(&fork_provider).await?;
            let cancel_bridge = bridge_cancel_flag(cancel);
            let result = session_memory::extract_session_memory(
                &messages,
                Arc::clone(&sm_state),
                &sm_config,
                provider.as_ref(),
                &fork_provider.model,
                Some(cancel_bridge.flag()),
            )
            .await;

            let content = result?;
            let last_idx = sm_state.lock().await.last_summarized_msg_idx;
            unified_persistence::save_session_memory_state(&job_sid, &content, last_idx)
                .map_err(|err| format!("Failed to persist session memory state: {err}"))?;
            Ok(())
        },
    )
    .with_cleanup(move |outcome| async move {
        if outcome != MemoryJobOutcome::Completed {
            cleanup_state.lock().await.extraction_in_progress = false;
        }
    });
    submit_memory_job(job);
}

// ── Workspace-memory extraction (step 9c) ──────────────────────────

pub(super) struct ExtractMemoriesInput<'a> {
    pub session_id: &'a str,
    pub agent_id: Option<String>,
    pub ws_path: PathBuf,
    pub em_state: Arc<Mutex<ExtractMemoriesState>>,
    pub fork_provider: ForkProviderSpec,
    pub tool_registry: Arc<ToolRegistry>,
}

pub(super) fn spawn_extract_memories(input: ExtractMemoriesInput<'_>) {
    let ExtractMemoriesInput {
        session_id,
        agent_id,
        ws_path,
        em_state,
        fork_provider,
        tool_registry,
    } = input;
    let sid = session_id.to_string();
    let job_sid = sid.clone();
    let job_agent_id = agent_id.clone();
    let cleanup_state = Arc::clone(&em_state);

    let job = MemoryJob::new(
        sid,
        agent_id,
        MemoryJobKind::WorkspaceExtraction,
        WORKSPACE_EXTRACTION_TIMEOUT,
        move |cancel| async move {
            if let Some(agent_id) = job_agent_id.as_deref() {
                if !memory_job_is_enabled(agent_id, MemoryJobKind::WorkspaceExtraction) {
                    return Ok(());
                }
            }

            let messages = load_durable_history(&job_sid)?;
            let main_wrote = {
                let mut state = em_state.lock().await;
                extract_memories::skip_if_main_agent_wrote_memory(
                    &mut state,
                    &messages,
                    ws_path.as_path(),
                )
            };
            let should_run = if main_wrote {
                false
            } else {
                let state = em_state.lock().await;
                extract_memories::should_extract(&state, &messages, Some(ws_path.as_path()))
            };
            if !should_run {
                let mut state = em_state.lock().await;
                extract_memories::record_turn(&mut state);
                return Ok(());
            }

            let provider = fresh_fork_provider(&fork_provider).await?;
            let cancel_bridge = bridge_cancel_flag(cancel);
            let params = crate::memory::MemoryAgentParams {
                messages: &messages,
                provider,
                model: &fork_provider.model,
                workspace: &ws_path,
                parent_tools: tool_registry,
                session_id: &job_sid,
                definitions_store: None,
                cancel_flag: Some(cancel_bridge.flag()),
            };
            let result = extract_memories::run_extraction(Arc::clone(&em_state), params).await;
            result
        },
    )
    .with_cleanup(move |outcome| async move {
        if outcome != MemoryJobOutcome::Completed {
            cleanup_state.lock().await.clear_in_progress();
        }
    });
    submit_memory_job(job);
}

// ── Auto-dream consolidation (step 9d) ─────────────────────────────

pub(super) struct AutoDreamInput<'a> {
    pub session_id: &'a str,
    pub agent_id: Option<String>,
    pub ws_path: PathBuf,
    pub ad_state: Arc<Mutex<AutoDreamState>>,
    pub fork_provider: ForkProviderSpec,
    pub tool_registry: Arc<ToolRegistry>,
}

pub(super) fn spawn_auto_dream(input: AutoDreamInput<'_>) {
    let AutoDreamInput {
        session_id,
        agent_id,
        ws_path,
        ad_state,
        fork_provider,
        tool_registry,
    } = input;
    let sid = session_id.to_string();
    let job_sid = sid.clone();
    let job_agent_id = agent_id.clone();

    let job = MemoryJob::new(
        sid,
        agent_id,
        MemoryJobKind::AutoDream,
        AUTO_DREAM_TIMEOUT,
        move |cancel| async move {
            if let Some(agent_id) = job_agent_id.as_deref() {
                if !memory_job_is_enabled(agent_id, MemoryJobKind::AutoDream) {
                    return Ok(());
                }
            }
            {
                let mut state = ad_state.lock().await;
                if !auto_dream::should_attempt(&state, &ws_path) {
                    return Ok(());
                }
                state.mark_scan_now();
            }

            let messages = load_durable_history(&job_sid)?;
            let provider = fresh_fork_provider(&fork_provider).await?;
            let cancel_bridge = bridge_cancel_flag(cancel);
            let params = crate::memory::MemoryAgentParams {
                messages: &messages,
                provider,
                model: &fork_provider.model,
                workspace: &ws_path,
                parent_tools: tool_registry,
                session_id: &job_sid,
                definitions_store: None,
                cancel_flag: Some(cancel_bridge.flag()),
            };
            let result = auto_dream::run_consolidation(params).await;
            result
        },
    );
    submit_memory_job(job);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_budget_keeps_recent_suffix() {
        let messages = vec![
            serde_json::json!({"role": "user", "content": "old".repeat(100)}),
            serde_json::json!({"role": "assistant", "content": "middle"}),
            serde_json::json!({"role": "user", "content": "new"}),
        ];
        let bounded = bound_memory_transcript(messages, 100);
        assert_eq!(bounded.len(), 2);
        assert_eq!(bounded[0]["content"], "middle");
        assert_eq!(bounded[1]["content"], "new");
    }

    #[test]
    fn transcript_budget_never_splits_tool_group() {
        let messages = vec![
            serde_json::json!({"role": "user", "content": "old".repeat(100)}),
            serde_json::json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            serde_json::json!({"role": "tool", "tool_call_id": "call-1", "content": "result"}),
        ];
        let bounded = bound_memory_transcript(messages, 1);
        assert_eq!(bounded.len(), 2, "newest oversized group stays intact");
        assert_eq!(bounded[0]["role"], "assistant");
        assert_eq!(bounded[1]["role"], "tool");
    }
}
