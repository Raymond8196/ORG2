use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use tauri::AppHandle;

use crate::coordination::agent_inbox::{
    AgentInboxStore, AgentMessage, InsertInboxParams, SYSTEM_SENDER_ID,
};
use crate::coordination::agent_org_runs::{
    AgentOrgRunStatus, AgentOrgRunStore, COORDINATOR_MEMBER_ID,
};
use crate::coordination::agent_org_tasks::{self, AgentOrgTaskStore, TaskStatus};
use crate::core::session::SessionStatus;
use crate::tools::impls::orchestration::inbox_wake::AppHandleInboxWakeHook;
use crate::tools::impls::orchestration::org_send_message::InboxWakeHook;

const WATCHDOG_INTERVAL_SECS: u64 = 60;
const STALE_IN_PROGRESS_MINUTES: i64 = 15;
const DELAYED_REWAKE_DELAYS: [Duration; 3] = [
    Duration::from_secs(60),
    Duration::from_secs(5 * 60),
    Duration::from_secs(15 * 60),
];

#[derive(Debug, Clone)]
struct RewakeBudgetEntry {
    attempts: usize,
    next_allowed_at: Instant,
}

static REWAKE_BUDGETS: OnceLock<Mutex<HashMap<(String, String), RewakeBudgetEntry>>> =
    OnceLock::new();

fn rewake_budgets() -> &'static Mutex<HashMap<(String, String), RewakeBudgetEntry>> {
    REWAKE_BUDGETS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn clear_rewake_budget(run_id: &str, member_id: &str) {
    let mut budgets = rewake_budgets()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    budgets.remove(&(run_id.to_string(), member_id.to_string()));
}

#[cfg(test)]
pub fn test_only_mark_failed_rewake_attempt(run_id: &str, member_id: &str) -> bool {
    delayed_rewake_allowed(run_id, member_id, SessionStatus::Failed)
}

fn delayed_rewake_allowed(run_id: &str, member_id: &str, status: SessionStatus) -> bool {
    if status != SessionStatus::Failed {
        return true;
    }
    let now = Instant::now();
    let key = (run_id.to_string(), member_id.to_string());
    let mut budgets = rewake_budgets()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = budgets.entry(key).or_insert_with(|| RewakeBudgetEntry {
        attempts: 0,
        next_allowed_at: now,
    });
    if entry.attempts >= DELAYED_REWAKE_DELAYS.len() || now < entry.next_allowed_at {
        return false;
    }
    let delay = DELAYED_REWAKE_DELAYS[entry.attempts];
    entry.attempts += 1;
    entry.next_allowed_at = now + delay;
    true
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentOrgStallState {
    NotStalled,
    HasEligibleClaimableWork { member_ids: Vec<String> },
    NeedsCoordinatorRepair { reason: String },
    TerminalCandidate,
}

pub fn spawn(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(WATCHDOG_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let handle = app_handle.clone();
            if let Err(err) =
                tokio::task::spawn_blocking(move || recover_all_stalled_runs(handle)).await
            {
                tracing::warn!(error = %err, "[agent_org_watchdog] watchdog task join failed");
            }
        }
    });
}

fn recover_all_stalled_runs(app_handle: AppHandle) -> Result<(), String> {
    for run in AgentOrgRunStore::list_runs(500)? {
        if run.status != AgentOrgRunStatus::Running {
            continue;
        }
        recover_stalled_run(app_handle.clone(), &run.id)?;
    }
    Ok(())
}

pub fn recover_stalled_run(
    app_handle: AppHandle,
    run_id: &str,
) -> Result<AgentOrgStallState, String> {
    let state = inspect_stalled_run(run_id)?;
    match &state {
        AgentOrgStallState::HasEligibleClaimableWork { member_ids } => {
            let wake_hook = AppHandleInboxWakeHook::new(app_handle);
            for member_id in member_ids {
                wake_hook.wake_member(member_id, run_id);
            }
        }
        AgentOrgStallState::NeedsCoordinatorRepair { reason } => {
            insert_coordinator_stall_notice(run_id, reason)?;
            AppHandleInboxWakeHook::new(app_handle).wake_member(COORDINATOR_MEMBER_ID, run_id);
        }
        AgentOrgStallState::TerminalCandidate => {
            let _ = AgentOrgRunStore::reconcile_if_terminal(run_id)?;
        }
        AgentOrgStallState::NotStalled => {}
    }
    Ok(state)
}

pub fn inspect_stalled_run(run_id: &str) -> Result<AgentOrgStallState, String> {
    if AgentOrgRunStore::get_run_status(run_id)? != Some(AgentOrgRunStatus::Running) {
        return Ok(AgentOrgStallState::NotStalled);
    }

    let tasks = AgentOrgTaskStore::list(run_id)?;
    let workers = AgentOrgRunStore::list_descendant_worker_sessions(run_id)?;
    if workers.iter().any(|worker| is_active_status(worker.status)) {
        return Ok(AgentOrgStallState::NotStalled);
    }

    let mut member_status = HashMap::new();
    let mut member_updated_at = HashMap::new();
    for worker in &workers {
        if let Some(member_id) = worker.member_id.as_deref() {
            member_status.insert(member_id.to_string(), worker.status);
            member_updated_at.insert(member_id.to_string(), worker.updated_at.clone());
        }
    }

    let mut eligible_wake_members = Vec::new();
    let mut needs_repair = Vec::new();

    for task in &tasks {
        if task.status.is_resolved() {
            continue;
        }
        if task.owner.is_some() {
            if let Some(owner) = task.owner.as_deref() {
                if member_status
                    .get(owner)
                    .is_some_and(|status| status.is_terminal())
                {
                    needs_repair.push(format!(
                        "task {} is owned by terminal member {}; retry the owner, reassign owner_member_id, or repair eligible_member_ids",
                        task.id, owner
                    ));
                } else if task.status == TaskStatus::InProgress
                    && is_stale_in_progress(task.updated_at.as_str(), member_updated_at.get(owner))
                    && !has_unread_for_member(run_id, owner)?
                {
                    let eligible = agent_org_tasks::eligible_member_ids(task);
                    let eligible = if eligible.is_empty() {
                        "none".to_string()
                    } else {
                        eligible.join(", ")
                    };
                    needs_repair.push(format!(
                        "task {} is still in_progress under member {} but appears stale; task_updated_at={}, owner_updated_at={}, eligible_member_ids=[{}]. Ask the owner to continue/retry, reassign owner_member_id, or repair eligible_member_ids.",
                        task.id,
                        owner,
                        task.updated_at,
                        member_updated_at
                            .get(owner)
                            .map(String::as_str)
                            .unwrap_or("unknown"),
                        eligible
                    ));
                }
            }
            continue;
        }
        if task.status != TaskStatus::Pending {
            continue;
        }
        let eligible_member_ids = agent_org_tasks::eligible_member_ids(task);
        if eligible_member_ids.is_empty() {
            needs_repair.push(format!(
                "task {} is unowned but has no eligible_member_ids; use task_update to set owner_member_id or eligible_member_ids",
                task.id
            ));
            continue;
        }
        for member_id in eligible_member_ids {
            if AgentOrgTaskStore::find_available_for_member(run_id, &member_id)?.is_none() {
                continue;
            }
            if let Some(status) = member_status.get(&member_id).copied() {
                if is_wakeable_status(status)
                    && delayed_rewake_allowed(run_id, &member_id, status)
                    && !eligible_wake_members
                        .iter()
                        .any(|existing| existing == &member_id)
                {
                    eligible_wake_members.push(member_id);
                }
            }
        }
    }

    if !eligible_wake_members.is_empty() && !has_any_unread_inbox(run_id, &eligible_wake_members)? {
        return Ok(AgentOrgStallState::HasEligibleClaimableWork {
            member_ids: eligible_wake_members,
        });
    }

    if !needs_repair.is_empty() && !has_unread_for_member(run_id, COORDINATOR_MEMBER_ID)? {
        return Ok(AgentOrgStallState::NeedsCoordinatorRepair {
            reason: needs_repair.join("\n"),
        });
    }

    let has_open_tasks = tasks.iter().any(|task| !task.status.is_resolved());
    if !has_open_tasks
        && !workers.is_empty()
        && workers.iter().all(|worker| worker.status.is_terminal())
    {
        return Ok(AgentOrgStallState::TerminalCandidate);
    }

    Ok(AgentOrgStallState::NotStalled)
}

fn is_active_status(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Running | SessionStatus::WaitingForUser | SessionStatus::WaitingForFunds
    )
}

fn is_wakeable_status(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Idle
            | SessionStatus::Completed
            | SessionStatus::Failed
            | SessionStatus::Cancelled
            | SessionStatus::Abandoned
            | SessionStatus::Timeout
    )
}

fn is_stale_in_progress(task_updated_at: &str, owner_updated_at: Option<&String>) -> bool {
    let stale_before = Utc::now() - ChronoDuration::minutes(STALE_IN_PROGRESS_MINUTES);
    let Ok(task_updated_at) = DateTime::parse_from_rfc3339(task_updated_at) else {
        return false;
    };
    if task_updated_at.with_timezone(&Utc) > stale_before {
        return false;
    }
    let Some(owner_updated_at) = owner_updated_at else {
        return true;
    };
    DateTime::parse_from_rfc3339(owner_updated_at)
        .map(|owner_updated_at| owner_updated_at.with_timezone(&Utc) <= stale_before)
        .unwrap_or(false)
}

fn has_any_unread_inbox(run_id: &str, member_ids: &[String]) -> Result<bool, String> {
    for member_id in member_ids {
        if has_unread_for_member(run_id, member_id)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn has_unread_for_member(run_id: &str, member_id: &str) -> Result<bool, String> {
    Ok(!AgentInboxStore::list_unread_for_member(member_id, run_id)?.is_empty())
}

fn insert_coordinator_stall_notice(run_id: &str, reason: &str) -> Result<(), String> {
    let store = crate::definitions::orgs::orgs_store();
    let Some(context) = AgentOrgRunStore::context_for_run(run_id, &store)? else {
        return Ok(());
    };
    AgentInboxStore::insert(InsertInboxParams {
        recipient_agent_id: context.coordinator_agent_id,
        recipient_member_id: Some(COORDINATOR_MEMBER_ID.to_string()),
        sender_agent_id: SYSTEM_SENDER_ID.to_string(),
        sender_member_id: None,
        org_run_id: Some(run_id.to_string()),
        message: AgentMessage::Plain {
            summary: "Agent Org recovery needed".to_string(),
            text: format!(
                "The Agent Org watchdog detected stalled work that needs coordinator repair.\n\n{reason}\n\nUse task_list/task_get to inspect the task board, then use task_update owner_member_id or eligible_member_ids to repair dispatch. Never assign work outside eligible_member_ids."
            ),
        },
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wakeable_status_includes_idle_and_terminal_but_not_running() {
        assert!(is_wakeable_status(SessionStatus::Idle));
        assert!(is_wakeable_status(SessionStatus::Failed));
        assert!(!is_wakeable_status(SessionStatus::Running));
    }

    #[test]
    fn delayed_rewake_budget_limits_and_clears_failed_member_retries() {
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let member_id = "member-a";
        assert!(delayed_rewake_allowed(
            run_id.as_str(),
            member_id,
            SessionStatus::Failed
        ));
        assert!(!delayed_rewake_allowed(
            run_id.as_str(),
            member_id,
            SessionStatus::Failed
        ));
        assert!(delayed_rewake_allowed(
            run_id.as_str(),
            member_id,
            SessionStatus::Idle
        ));
        clear_rewake_budget(run_id.as_str(), member_id);
        assert!(delayed_rewake_allowed(
            run_id.as_str(),
            member_id,
            SessionStatus::Failed
        ));
    }
}
