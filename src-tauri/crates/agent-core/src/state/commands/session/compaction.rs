use std::sync::atomic::Ordering;
use std::sync::Arc;

use tracing::{info, warn};

use crate::core::model_context::cleanup::post_compact_cleanup;
use crate::core::model_context::compaction::{CompactionOutcome, ContextCompactor};
use crate::core::session::compaction::manual::MIN_HISTORY_FOR_MANUAL_COMPACT;
use crate::core::session::compaction::persist;
use crate::session::persistence as unified_persistence;
use crate::state::AgentAppState;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManualCompactStatus {
    Compacted,
    TooShort,
    AlreadyCompact,
    Busy,
    NoRuntime,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualCompactCommandResult {
    pub status: ManualCompactStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_before: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_after: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_before: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_after: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

impl ManualCompactCommandResult {
    fn status(status: ManualCompactStatus) -> Self {
        Self {
            status,
            message: None,
            messages_before: None,
            messages_after: None,
            tokens_before: None,
            tokens_after: None,
            truncated: None,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            status: ManualCompactStatus::Failed,
            message: Some(message.into()),
            messages_before: None,
            messages_after: None,
            tokens_before: None,
            tokens_after: None,
            truncated: None,
        }
    }
}

/// Desktop-only manual compaction. Unlike gateway `/compact`, this rewrites the
/// visible durable transcript in-place by appending a compact boundary and does
/// not fork the session.
#[tauri::command]
pub async fn agent_session_manual_compact(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
) -> Result<ManualCompactCommandResult, String> {
    let Some(session) = state.get_session(&session_id).await else {
        return Ok(ManualCompactCommandResult::status(
            ManualCompactStatus::NoRuntime,
        ));
    };

    if session.scheduler.is_processing() {
        return Ok(ManualCompactCommandResult::status(
            ManualCompactStatus::Busy,
        ));
    }

    let runtime = {
        let guard = session.runtime.read().await;
        match guard.clone() {
            Some(runtime) => runtime,
            None => {
                return Ok(ManualCompactCommandResult::status(
                    ManualCompactStatus::NoRuntime,
                ));
            }
        }
    };

    let sid_for_load = session_id.clone();
    let history = match tokio::task::spawn_blocking(move || {
        unified_persistence::load_llm_history(&sid_for_load)
    })
    .await
    {
        Ok(Ok(history)) => history,
        Ok(Err(err)) => {
            let reason = format!("load_llm_history failed: {}", err);
            warn!("[manual_compact_desktop] {}", reason);
            return Ok(ManualCompactCommandResult::failed(reason));
        }
        Err(err) => {
            let reason = format!("load_llm_history join error: {}", err);
            warn!("[manual_compact_desktop] {}", reason);
            return Ok(ManualCompactCommandResult::failed(reason));
        }
    };

    let messages_before = history.len();
    if messages_before < MIN_HISTORY_FOR_MANUAL_COMPACT {
        let mut result = ManualCompactCommandResult::status(ManualCompactStatus::TooShort);
        result.messages_before = Some(messages_before);
        return Ok(result);
    }

    if persist::is_recently_compacted_without_new_tail(&history) {
        let tokens_before = ContextCompactor::estimate_messages_tokens(&history);
        let mut result = ManualCompactCommandResult::status(ManualCompactStatus::AlreadyCompact);
        result.messages_before = Some(messages_before);
        result.tokens_before = Some(tokens_before);
        return Ok(result);
    }

    let tokens_before = ContextCompactor::estimate_messages_tokens(&history);
    let budget_tokens = tokens_before.max(1);

    let hook_executor = Arc::new(
        crate::specialization::hooks::HookExecutor::load_with_workspace_scope(
            runtime.workspace_state.read().working_dir(),
            runtime.resolved.load_workspace_resources,
        ),
    );

    crate::specialization::hooks::dispatch::fire_pre_compaction(
        Some(&hook_executor),
        &session_id,
        "manual",
        messages_before,
    )
    .await;

    let (compacted, outcome) = {
        let mut compaction_state = session.compaction.lock().await;
        ContextCompactor::compact_manual_force(
            &history,
            budget_tokens,
            &runtime.resolved.compaction,
            &mut compaction_state,
            runtime.provider.as_ref(),
            &runtime.model,
        )
        .await
    };

    if matches!(outcome, CompactionOutcome::Skipped) || !outcome_dropped_messages(&outcome) {
        return Ok(already_compact_result(
            messages_before,
            tokens_before,
            Some("no compactable segment produced".to_string()),
        ));
    }

    let truncated = matches!(outcome, CompactionOutcome::Truncated { .. });
    let mut compacted = post_compact_cleanup(compacted);

    crate::model_context::file_reinjection::reinject_files_after_compaction(
        &history,
        &mut compacted,
    );
    crate::model_context::plan_preservation::reinject_plan_after_compaction(
        &history,
        &mut compacted,
    );

    let messages_after = compacted.len();
    let tokens_after = ContextCompactor::estimate_messages_tokens(&compacted);

    if messages_after >= messages_before && tokens_after >= tokens_before {
        return Ok(already_compact_result(
            messages_before,
            tokens_before,
            Some("compaction did not reduce history".to_string()),
        ));
    }

    crate::specialization::hooks::dispatch::fire_post_compaction(
        Some(&hook_executor),
        &session_id,
        "manual",
        messages_before,
        messages_after,
    );

    let persist_result = tokio::task::spawn_blocking({
        let sid = session_id.clone();
        let compacted = compacted.clone();
        move || -> Result<(), String> {
            persist::append_in_place_compact_boundary(&sid, &compacted)?;
            persist::persist_session_memory_after_compact(&sid)?;
            Ok(())
        }
    })
    .await;

    match persist_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            warn!(
                "[manual_compact_desktop] failed to persist compact boundary for session {}: {}",
                session_id, err
            );
            return Ok(ManualCompactCommandResult::failed(err));
        }
        Err(err) => {
            let reason = format!("compact boundary persistence join error: {}", err);
            warn!("[manual_compact_desktop] {}", reason);
            return Ok(ManualCompactCommandResult::failed(reason));
        }
    }

    session.last_context_tokens.store(0, Ordering::SeqCst);

    info!(
        "[manual_compact_desktop] {}: {} messages ({} tokens) -> {} messages ({} tokens), truncated={}",
        session_id,
        messages_before,
        tokens_before,
        messages_after,
        tokens_after,
        truncated
    );

    Ok(ManualCompactCommandResult {
        status: ManualCompactStatus::Compacted,
        message: None,
        messages_before: Some(messages_before),
        messages_after: Some(messages_after),
        tokens_before: Some(tokens_before),
        tokens_after: Some(tokens_after),
        truncated: Some(truncated),
    })
}

fn outcome_dropped_messages(outcome: &CompactionOutcome) -> bool {
    match outcome {
        CompactionOutcome::Compacted {
            messages_dropped, ..
        } => *messages_dropped > 0,
        CompactionOutcome::Truncated { messages_dropped } => *messages_dropped > 0,
        CompactionOutcome::Skipped => false,
    }
}

fn already_compact_result(
    messages_before: usize,
    tokens_before: usize,
    message: Option<String>,
) -> ManualCompactCommandResult {
    ManualCompactCommandResult {
        status: ManualCompactStatus::AlreadyCompact,
        message,
        messages_before: Some(messages_before),
        messages_after: Some(messages_before),
        tokens_before: Some(tokens_before),
        tokens_after: Some(tokens_before),
        truncated: Some(false),
    }
}
