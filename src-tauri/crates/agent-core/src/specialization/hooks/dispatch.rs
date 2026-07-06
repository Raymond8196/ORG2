//! Dispatch helpers for lifecycle events fired outside the tool-call
//! pipeline (session init, user-message arrival, compaction runs).
//!
//! Tool-call events (PreToolUse / PostToolUse / PostToolUseFailure / Stop)
//! stay in `core::session::turn::event_handler::hooks_dispatch`, which owns
//! their verdict parsing. The events here carry no verdict back — they are
//! notification-style, so all except `PreCompaction` run fire-and-forget.

use std::path::Path;
use std::sync::Arc;

use super::events::HookContext;
use super::{HookEvent, HookExecutor};

/// Cap on the user-message excerpt passed to `NotificationReceived` hooks
/// (same bound as the PostToolUse result excerpt).
const MESSAGE_EXCERPT_MAX_CHARS: usize = 5000;

/// Fire `SessionStart` in the background.
///
/// Called from the session-init slow path, so it fires once per runtime
/// (re)build — fresh start or resume after an app restart — not per turn
/// (the init fast path returns before reaching this).
pub fn fire_session_start(
    workspace_root: &Path,
    load_workspace_resources: bool,
    session_id: &str,
    model: &str,
) {
    let executor =
        HookExecutor::load_with_workspace_scope(workspace_root, load_workspace_resources);
    if !executor.has_hooks_for(HookEvent::SessionStart) {
        return;
    }
    let ctx = HookContext::for_session(session_id)
        .with_var("ORGII_WORKSPACE_ROOT", workspace_root.to_string_lossy())
        .with_var("ORGII_MODEL", model);
    let sid = session_id.to_string();
    tokio::spawn(async move {
        executor.run(HookEvent::SessionStart, &ctx).await;
        tracing::info!("[hooks] SessionStart hooks fired for {}", sid);
    });
}

/// Fire `NotificationReceived` in the background for an inbound user message.
pub fn fire_notification_received(executor: &Arc<HookExecutor>, session_id: &str, message: &str) {
    if !executor.has_hooks_for(HookEvent::NotificationReceived) {
        return;
    }
    let ctx = HookContext::for_session(session_id).with_var(
        "ORGII_USER_MESSAGE",
        crate::utils::safe_truncate_chars_to_string(message, MESSAGE_EXCERPT_MAX_CHARS),
    );
    let executor = Arc::clone(executor);
    tokio::spawn(async move {
        executor.run(HookEvent::NotificationReceived, &ctx).await;
    });
}

/// Fire `PreCompaction` and WAIT for completion.
///
/// Synchronous on purpose: the load-bearing use case is backing up the
/// transcript before compaction rewrites it, so the hook must finish before
/// history is mutated. Bounded by the per-hook 30s cap; hooks for one event
/// run concurrently.
pub async fn fire_pre_compaction(
    executor: Option<&Arc<HookExecutor>>,
    session_id: &str,
    trigger: &str,
    messages_before: usize,
) {
    let Some(executor) = executor else {
        return;
    };
    if !executor.has_hooks_for(HookEvent::PreCompaction) {
        return;
    }
    let ctx = compaction_context(session_id, trigger, messages_before);
    executor.run(HookEvent::PreCompaction, &ctx).await;
}

/// Fire `PostCompaction` in the background — nothing feeds back.
pub fn fire_post_compaction(
    executor: Option<&Arc<HookExecutor>>,
    session_id: &str,
    trigger: &str,
    messages_before: usize,
    messages_after: usize,
) {
    let Some(executor) = executor else {
        return;
    };
    if !executor.has_hooks_for(HookEvent::PostCompaction) {
        return;
    }
    let ctx = compaction_context(session_id, trigger, messages_before)
        .with_var("ORGII_MESSAGES_AFTER", messages_after.to_string());
    let executor = Arc::clone(executor);
    tokio::spawn(async move {
        executor.run(HookEvent::PostCompaction, &ctx).await;
    });
}

/// Shared payload for the compaction pair. `trigger` mirrors the reference
/// harness contract: "auto" (pre-turn / reactive) or "manual" (/compact).
fn compaction_context(session_id: &str, trigger: &str, messages_before: usize) -> HookContext {
    HookContext::for_session(session_id)
        .with_var("ORGII_COMPACTION_TRIGGER", trigger)
        .with_var("ORGII_MESSAGES_BEFORE", messages_before.to_string())
}
