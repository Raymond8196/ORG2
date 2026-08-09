//! Child-done parent wake.
//!
//! When the last open sub-item of a parent Work Item settles (every
//! child reaches a terminal portable state), the parent's Discussion
//! gets a system progress note and the parent's latest linked session
//! is resumed with a barrier summary so its agent can close out or
//! advance the plan. Per-child completions do NOT wake the parent —
//! only the closure of the whole (implicit) stage does, so multi-child
//! plans produce one wake instead of a wake storm.

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::OnceLock;

use tracing::{info, warn};

use project_management::projects::events::WorkItemTerminalEvent;
use project_management::projects::io as pio;
use project_management::projects::types::{WorkItemData, WorkItemMutationActor};
use project_management::work_service;
use project_management::work_service::state::{map_legacy_status, WorkItemState};

fn is_terminal(status: &str) -> bool {
    matches!(
        map_legacy_status(status),
        Some(WorkItemState::Completed | WorkItemState::Failed | WorkItemState::Cancelled)
    )
}

fn wake_dedupe() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Register the terminal-transition observer. Called once at app setup.
pub fn register(app: tauri::AppHandle) {
    project_management::projects::events::register_work_item_terminal_notifier(Box::new(
        move |event| {
            process_event(app.clone(), event);
        },
    ));
}

/// Dispatch one terminal transition into the wake pipeline. Shared by
/// the in-process notifier (app-local writes) and the cross-process
/// audit-stream bridge (CLI writes); barrier-level dedupe makes double
/// delivery of the same closure harmless.
pub fn process_event(app: tauri::AppHandle, event: WorkItemTerminalEvent) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = handle_child_terminal(app, event.clone()).await {
            warn!(
                child = %event.short_id,
                error = %error,
                "[child-done-wake] failed to process terminal transition"
            );
        }
    });
}

/// Cross-process bridge: fold audit-stream status transitions committed
/// by OTHER processes (the org2-pm CLI in agent shells) into the same
/// wake pipeline. Returns the number of terminal crossings dispatched.
pub fn process_audit_window(app: &tauri::AppHandle, after_seq: i64) -> usize {
    let transitions =
        match project_management::work_service::audit::read_status_transitions_since(after_seq) {
            Ok(rows) => rows,
            Err(error) => {
                warn!(error = %error, "[child-done-wake] audit window read failed");
                return 0;
            }
        };
    let mut dispatched = 0;
    for transition in transitions {
        if is_terminal(&transition.status_from) || !is_terminal(&transition.status_to) {
            continue;
        }
        let org_id = transition
            .org_id
            .clone()
            .unwrap_or_else(|| "personal-org".to_string());
        let item = match pio::read_work_item_by_row_id(&org_id, &transition.entity_id) {
            Ok(Some(item)) => item,
            _ => continue,
        };
        process_event(
            app.clone(),
            WorkItemTerminalEvent {
                org_id,
                project_slug: transition.project_slug.clone(),
                short_id: item.frontmatter.short_id.clone(),
                parent: item.frontmatter.parent.clone(),
                status: transition.status_to.clone(),
            },
        );
        dispatched += 1;
    }
    dispatched
}

async fn handle_child_terminal(
    app: tauri::AppHandle,
    event: WorkItemTerminalEvent,
) -> Result<(), String> {
    let Some(parent_short_id) = event.parent.clone() else {
        return Ok(());
    };

    let barrier = tokio::task::spawn_blocking({
        let event = event.clone();
        let parent_short_id = parent_short_id.clone();
        move || evaluate_barrier(&event, &parent_short_id)
    })
    .await
    .map_err(|err| format!("join error: {err}"))??;

    let Some(barrier) = barrier else {
        return Ok(());
    };

    let dedupe_key = format!(
        "{}/{}/{}",
        event.org_id,
        event.project_slug.as_deref().unwrap_or("-"),
        parent_short_id
    );
    {
        let mut seen = wake_dedupe().lock().map_err(|_| "dedupe poisoned")?;
        if !seen.insert(format!("{dedupe_key}:{}", barrier.settled_key)) {
            return Ok(());
        }
    }

    let note = barrier.summary.clone();
    {
        let event = event.clone();
        let parent_short_id = parent_short_id.clone();
        let note = note.clone();
        tokio::task::spawn_blocking(move || post_parent_note(&event, &parent_short_id, &note))
            .await
            .map_err(|err| format!("join error: {err}"))??;
    }
    project_management::projects::events::notify_data_changed();

    let Some(session_id) = barrier.parent_session_id else {
        info!(
            parent = %parent_short_id,
            "[child-done-wake] barrier closed; note posted (no linked session to wake)"
        );
        return Ok(());
    };

    use tauri::Manager;
    let Some(state) = app.try_state::<crate::state::AgentAppState>() else {
        return Err("AgentAppState unavailable".to_string());
    };
    let content = format!(
        "[Sub-items complete] {note}\n\nReview the parent with `org2-pm work show {parent_short_id}` \
         and decide the next step — close it out, or create/advance follow-up items. \
         Deliver every outcome through org2-pm with exactly one Discussion receipt."
    );
    let display_text = format!("🧩 Sub-item barrier closed on {parent_short_id}");
    crate::state::commands::session::message::send_message_impl(
        &state,
        session_id.clone(),
        content,
        Some(display_text),
        crate::state::commands::session::identity::IdentityOverrides::default(),
        None,
        None,
        None,
        false,
        false,
        None,
        None,
        None,
        None,
        crate::foundation::session_bridge::TurnIntentBridgeSource::Queue,
    )
    .await
    .map_err(|err| format!("wake enqueue failed: {err}"))?;
    info!(
        parent = %parent_short_id,
        session_id,
        "[child-done-wake] barrier closed; parent session woken"
    );
    Ok(())
}

struct BarrierClosure {
    /// Stable key of the settled barrier (stage-scoped), so
    /// re-transitions of an already-closed barrier don't wake twice.
    settled_key: String,
    /// Human summary shared by the parent's Discussion note and the
    /// wake message.
    summary: String,
    parent_session_id: Option<String>,
}

fn completed_count(children: &[&WorkItemData]) -> usize {
    children
        .iter()
        .filter(|child| {
            matches!(
                map_legacy_status(&child.frontmatter.status),
                Some(WorkItemState::Completed)
            )
        })
        .count()
}

fn sorted_ids_key(children: &[&WorkItemData]) -> String {
    let mut ids: Vec<&str> = children
        .iter()
        .map(|child| child.frontmatter.short_id.as_str())
        .collect();
    ids.sort_unstable();
    ids.join(",")
}

fn evaluate_barrier(
    event: &WorkItemTerminalEvent,
    parent_short_id: &str,
) -> Result<Option<BarrierClosure>, String> {
    let items: Vec<WorkItemData> = match event.project_slug.as_deref() {
        Some(slug) => pio::read_all_work_items(slug)?,
        None => pio::read_standalone_work_items(Some(event.org_id.as_str()))?,
    };

    let parent = items
        .iter()
        .find(|item| item.frontmatter.short_id == parent_short_id);
    let Some(parent) = parent else {
        return Ok(None);
    };
    if is_terminal(&parent.frontmatter.status) {
        return Ok(None);
    }

    let children: Vec<&WorkItemData> = items
        .iter()
        .filter(|item| {
            item.frontmatter.parent.as_deref() == Some(parent_short_id)
                && item.frontmatter.deleted_at.is_none()
        })
        .collect();
    if children.is_empty() {
        return Ok(None);
    }

    let parent_session_id = parent
        .frontmatter
        .linked_sessions
        .iter()
        .filter(|session| session.parent_session_id.is_none())
        .max_by(|a, b| a.started_at.cmp(&b.started_at))
        .map(|session| session.session_id.clone());

    let staged: Vec<&WorkItemData> = children
        .iter()
        .copied()
        .filter(|child| child.frontmatter.stage.is_some())
        .collect();

    if staged.is_empty() {
        // Implicit single stage: the barrier is the whole child set.
        if !children
            .iter()
            .all(|child| is_terminal(&child.frontmatter.status))
        {
            return Ok(None);
        }
        let completed = completed_count(&children);
        let summary = format!(
            "All {} sub-items of {} are settled ({} completed, {} cancelled/failed). Latest: {} → {}.",
            children.len(),
            parent_short_id,
            completed,
            children.len() - completed,
            event.short_id,
            event.status,
        );
        return Ok(Some(BarrierClosure {
            settled_key: sorted_ids_key(&children),
            summary,
            parent_session_id,
        }));
    }

    // Staged frontier semantics: only a STAGED child's
    // completion can close a barrier; stage S closes when every staged
    // sibling with stage <= S is terminal. Unstaged children are ignored.
    let Some(triggering_stage) = children
        .iter()
        .find(|child| child.frontmatter.short_id == event.short_id)
        .and_then(|child| child.frontmatter.stage)
    else {
        return Ok(None);
    };
    let frontier: Vec<&WorkItemData> = staged
        .iter()
        .copied()
        .filter(|child| child.frontmatter.stage.unwrap_or(u32::MAX) <= triggering_stage)
        .collect();
    if !frontier
        .iter()
        .all(|child| is_terminal(&child.frontmatter.status))
    {
        return Ok(None);
    }

    let mut stage_numbers: Vec<u32> = staged
        .iter()
        .filter_map(|child| child.frontmatter.stage)
        .collect();
    stage_numbers.sort_unstable();
    stage_numbers.dedup();
    let mut progress_parts: Vec<String> = Vec::new();
    let mut next_stage: Option<u32> = None;
    for stage in &stage_numbers {
        let members: Vec<&WorkItemData> = staged
            .iter()
            .copied()
            .filter(|child| child.frontmatter.stage == Some(*stage))
            .collect();
        let settled = members
            .iter()
            .filter(|child| is_terminal(&child.frontmatter.status))
            .count();
        let marker = if *stage > triggering_stage && next_stage.is_none() && settled < members.len()
        {
            next_stage = Some(*stage);
            " (next)"
        } else {
            ""
        };
        progress_parts.push(format!("Stage {}: {}/{}{}", stage, settled, members.len(), marker));
    }
    let next_hint = match next_stage {
        Some(stage) => format!(
            " Advance the Stage {} sub-items next (org2-pm work claim/transition), or close out if nothing remains.",
            stage
        ),
        None => " No later stage remains — review and close out the parent.".to_string(),
    };
    let summary = format!(
        "Stage {} of {} is complete ({}). Latest: {} → {}.{}",
        triggering_stage,
        parent_short_id,
        progress_parts.join("; "),
        event.short_id,
        event.status,
        next_hint,
    );
    Ok(Some(BarrierClosure {
        settled_key: format!("stage{}:{}", triggering_stage, sorted_ids_key(&frontier)),
        summary,
        parent_session_id,
    }))
}

fn post_parent_note(
    event: &WorkItemTerminalEvent,
    parent_short_id: &str,
    note: &str,
) -> Result<(), String> {
    let actor = WorkItemMutationActor {
        id: "system".to_string(),
        name: "System".to_string(),
    };
    match event.project_slug.as_deref() {
        Some(slug) => {
            work_service::note_project_work_item(slug, parent_short_id, "progress", note, Some(&actor))
        }
        None => work_service::note_standalone_work_item(
            Some(event.org_id.as_str()),
            parent_short_id,
            "progress",
            note,
            Some(&actor),
        ),
    }
}
