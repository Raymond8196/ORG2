//! Agent Org watchdog: periodic stall detection and recovery.
//!
//! Every [`WATCHDOG_INTERVAL_SECS`] the watchdog scans running Agent Org
//! runs whose workers are all quiescent and produces a
//! [`StallRecoveryPlan`]:
//!
//! - **Wake members** that have durable input: unread inbox rows, a
//!   redelivered explicit assignment, or a concrete continuation message.
//!   Ownerless work and mere ownership are not wake signals: without real
//!   input they would create empty turns and UI flicker.
//! - **Escalate to the coordinator** when the board cannot make progress
//!   without explicit repair: tasks owned by dead members, stale
//!   `in_progress` work, and ready ownerless tasks awaiting explicit
//!   coordinator assignment (issue #272 E1).
//! - **Reconcile the run** when every task is resolved and every worker
//!   is terminal.
//!
//! Failed members are rate-limited by a per-`(run, member)` rewake budget
//! (three attempts with 1/5/15-minute backoff) that resets on the next
//! successful member turn.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use database::db::{get_connection, with_sessions_writer};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

use crate::coordination::agent_inbox::{
    AgentInboxStore, AgentMessage, InsertInboxParams, SYSTEM_SENDER_ID,
};
use crate::coordination::agent_org_plan_approvals::AgentOrgPlanApprovalStore;
use crate::coordination::agent_org_runs::{
    AgentOrgFinalityBlocker, AgentOrgFinalityDecision, AgentOrgRunRecord, AgentOrgRunStatus,
    AgentOrgRunStore, COORDINATOR_MEMBER_ID,
};
use crate::coordination::agent_org_tasks::{self, Task, TaskStatus};
use crate::core::session::SessionStatus;
use crate::tools::impls::orchestration::inbox_wake::AppHandleInboxWakeHook;
use crate::tools::impls::orchestration::org_send_message::InboxWakeHook;

const WATCHDOG_INTERVAL_SECS: u64 = 60;
const RECOVERY_DELAYS_SECS: [i64; 3] = [60, 5 * 60, 15 * 60];
const MEMBER_REWAKE: &str = "member_rewake";
const COORDINATOR_NOTICE: &str = "coordinator_notice";

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_org_recovery_attempts (
            org_run_id TEXT NOT NULL,
            action_kind TEXT NOT NULL,
            target_key TEXT NOT NULL,
            reason_fingerprint TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_allowed_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reservation_token TEXT,
            PRIMARY KEY (org_run_id, action_kind, target_key)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_org_recovery_attempts_run
            ON agent_org_recovery_attempts(org_run_id);",
    )?;
    // Existing databases predate dispatch reservations. Keeping the token in
    // the same row lets a failed/coalesced scheduler request refund only its
    // own provisional attempt without undoing a newer recovery fingerprint.
    ensure_recovery_attempt_column(conn, "reservation_token", "TEXT")?;
    Ok(())
}

fn ensure_recovery_attempt_column(
    conn: &Connection,
    column_name: &str,
    column_definition: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(agent_org_recovery_attempts)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for column in columns {
        if column? == column_name {
            return Ok(());
        }
    }
    conn.execute(
        &format!(
            "ALTER TABLE agent_org_recovery_attempts ADD COLUMN {column_name} {column_definition}"
        ),
        [],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BudgetDisposition {
    Allowed,
    Backoff,
    Exhausted,
}

fn budget_disposition(
    run_id: &str,
    action_kind: &str,
    target_key: &str,
    fingerprint: &str,
) -> Result<BudgetDisposition, String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    budget_disposition_with_connection(&conn, run_id, action_kind, target_key, fingerprint)
}

fn budget_disposition_with_connection(
    conn: &Connection,
    run_id: &str,
    action_kind: &str,
    target_key: &str,
    fingerprint: &str,
) -> Result<BudgetDisposition, String> {
    let row: Option<(String, i64, String)> = conn
        .query_row(
            "SELECT reason_fingerprint, attempts, next_allowed_at
             FROM agent_org_recovery_attempts
             WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3",
            params![run_id, action_kind, target_key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some((stored_fingerprint, attempts, next_allowed_at)) = row else {
        return Ok(BudgetDisposition::Allowed);
    };
    if stored_fingerprint != fingerprint {
        return Ok(BudgetDisposition::Allowed);
    }
    let next_allowed_at = match DateTime::parse_from_rfc3339(&next_allowed_at) {
        Ok(parsed) => parsed.with_timezone(&Utc),
        Err(err) => {
            // A corrupt persisted deadline must not suppress recovery forever.
            // Fail open for this tick; an accepted action rewrites the row with
            // a valid UTC timestamp through `record_attempt`.
            tracing::warn!(
                run_id,
                action_kind,
                target_key,
                value = %next_allowed_at,
                error = %err,
                "[agent_org_watchdog] invalid recovery deadline; allowing retry"
            );
            return Ok(BudgetDisposition::Allowed);
        }
    };
    if Utc::now() < next_allowed_at {
        // Every accepted attempt owns its full 1/5/15 minute cooling-off
        // window.  In particular, the third attempt is not "exhausted"
        // immediately after dispatch; it becomes exhausted only after its
        // 15-minute deadline passes without recovery.
        return Ok(BudgetDisposition::Backoff);
    }
    Ok(if attempts >= RECOVERY_DELAYS_SECS.len() as i64 {
        BudgetDisposition::Exhausted
    } else {
        BudgetDisposition::Allowed
    })
}

fn record_attempt(
    run_id: &str,
    action_kind: &str,
    target_key: &str,
    fingerprint: &str,
) -> Result<(), String> {
    with_sessions_writer(|| -> Result<(), String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        record_attempt_with_connection(&tx, run_id, action_kind, target_key, fingerprint)?;
        tx.commit().map_err(|err| err.to_string())
    })
}

/// Record an accepted recovery dispatch using the caller's transaction.
/// Member-Wake reservations use this before handing work to the in-memory
/// scheduler, then commit or refund the provisional attempt by token.
fn record_attempt_with_connection(
    conn: &Connection,
    run_id: &str,
    action_kind: &str,
    target_key: &str,
    fingerprint: &str,
) -> Result<(), String> {
    let previous: Option<(String, i64)> = conn
        .query_row(
            "SELECT reason_fingerprint, attempts FROM agent_org_recovery_attempts
             WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3",
            params![run_id, action_kind, target_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let attempts = match previous {
        Some((stored, attempts)) if stored == fingerprint => attempts
            .clamp(0, RECOVERY_DELAYS_SECS.len() as i64)
            .saturating_add(1),
        _ => 1,
    };
    let delay_index =
        (attempts.saturating_sub(1) as usize).min(RECOVERY_DELAYS_SECS.len().saturating_sub(1));
    let now = Utc::now();
    let next = now + ChronoDuration::seconds(RECOVERY_DELAYS_SECS[delay_index]);
    conn.execute(
        "INSERT INTO agent_org_recovery_attempts
             (org_run_id, action_kind, target_key, reason_fingerprint, attempts, next_allowed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(org_run_id, action_kind, target_key) DO UPDATE SET
             reason_fingerprint=excluded.reason_fingerprint,
             attempts=excluded.attempts,
             next_allowed_at=excluded.next_allowed_at,
             updated_at=excluded.updated_at,
             reservation_token=NULL",
        params![
            run_id,
            action_kind,
            target_key,
            fingerprint,
            attempts,
            next.to_rfc3339(),
            now.to_rfc3339()
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn clear_rewake_budget(run_id: &str, member_id: &str) -> Result<(), String> {
    with_sessions_writer(|| {
        let conn = get_connection().map_err(|err| err.to_string())?;
        conn.execute(
            "DELETE FROM agent_org_recovery_attempts
             WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3",
            params![run_id, MEMBER_REWAKE, member_id],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    })
}

#[derive(Debug, Clone)]
struct RecoveryAttemptSnapshot {
    reason_fingerprint: String,
    attempts: i64,
    next_allowed_at: String,
    updated_at: String,
    reservation_token: Option<String>,
}

/// Provisional durable claim for one scheduler dispatch.
///
/// SQLite and the in-memory scheduler cannot share a transaction. Reserving
/// first closes the unsafe side of that gap: a crash can conservatively spend
/// one cooldown, but it cannot enqueue a provider turn that was never charged
/// to the recovery budget. Failed/coalesced requests refund by this unique
/// token, so they cannot roll back a newer fingerprint's reservation.
pub(crate) struct MemberRewakeReservation {
    run_id: String,
    member_id: String,
    token: String,
    previous: Option<RecoveryAttemptSnapshot>,
}

pub(crate) enum MemberRewakeReservationOutcome {
    Reserved(MemberRewakeReservation),
    Deferred,
}

pub(crate) fn reserve_member_rewake_dispatch(
    run_id: &str,
    member_id: &str,
    fingerprint: &str,
) -> Result<MemberRewakeReservationOutcome, String> {
    with_sessions_writer(|| -> Result<MemberRewakeReservationOutcome, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        if !matches!(
            budget_disposition_with_connection(&tx, run_id, MEMBER_REWAKE, member_id, fingerprint,)?,
            BudgetDisposition::Allowed
        ) {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(MemberRewakeReservationOutcome::Deferred);
        }

        let previous = tx
            .query_row(
                "SELECT reason_fingerprint, attempts, next_allowed_at, updated_at,
                        reservation_token
                 FROM agent_org_recovery_attempts
                 WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3",
                params![run_id, MEMBER_REWAKE, member_id],
                |row| {
                    Ok(RecoveryAttemptSnapshot {
                        reason_fingerprint: row.get(0)?,
                        attempts: row.get(1)?,
                        next_allowed_at: row.get(2)?,
                        updated_at: row.get(3)?,
                        reservation_token: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|err| err.to_string())?;
        record_attempt_with_connection(&tx, run_id, MEMBER_REWAKE, member_id, fingerprint)?;
        let token = uuid::Uuid::new_v4().to_string();
        let updated = tx
            .execute(
                "UPDATE agent_org_recovery_attempts
                 SET reservation_token=?1
                 WHERE org_run_id=?2 AND action_kind=?3 AND target_key=?4
                   AND reason_fingerprint=?5",
                params![&token, run_id, MEMBER_REWAKE, member_id, fingerprint],
            )
            .map_err(|err| err.to_string())?;
        if updated != 1 {
            return Err("member rewake reservation disappeared before commit".to_string());
        }
        tx.commit().map_err(|err| err.to_string())?;
        Ok(MemberRewakeReservationOutcome::Reserved(
            MemberRewakeReservation {
                run_id: run_id.to_string(),
                member_id: member_id.to_string(),
                token,
                previous,
            },
        ))
    })
}

pub(crate) fn commit_member_rewake_reservation(
    reservation: &MemberRewakeReservation,
) -> Result<(), String> {
    with_sessions_writer(|| -> Result<(), String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        conn.execute(
            "UPDATE agent_org_recovery_attempts
             SET reservation_token=NULL
             WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3
               AND reservation_token=?4",
            params![
                &reservation.run_id,
                MEMBER_REWAKE,
                &reservation.member_id,
                &reservation.token,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    })
}

pub(crate) fn refund_member_rewake_reservation(
    reservation: &MemberRewakeReservation,
) -> Result<bool, String> {
    with_sessions_writer(|| -> Result<bool, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let owns_current: bool = tx
            .query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM agent_org_recovery_attempts
                     WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3
                       AND reservation_token=?4
                 )",
                params![
                    &reservation.run_id,
                    MEMBER_REWAKE,
                    &reservation.member_id,
                    &reservation.token,
                ],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;
        if !owns_current {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(false);
        }

        if let Some(previous) = reservation.previous.as_ref() {
            tx.execute(
                "UPDATE agent_org_recovery_attempts
                 SET reason_fingerprint=?1, attempts=?2, next_allowed_at=?3,
                     updated_at=?4, reservation_token=?5
                 WHERE org_run_id=?6 AND action_kind=?7 AND target_key=?8
                   AND reservation_token=?9",
                params![
                    &previous.reason_fingerprint,
                    previous.attempts,
                    &previous.next_allowed_at,
                    &previous.updated_at,
                    previous.reservation_token.as_deref(),
                    &reservation.run_id,
                    MEMBER_REWAKE,
                    &reservation.member_id,
                    &reservation.token,
                ],
            )
            .map_err(|err| err.to_string())?;
        } else {
            tx.execute(
                "DELETE FROM agent_org_recovery_attempts
                 WHERE org_run_id=?1 AND action_kind=?2 AND target_key=?3
                   AND reservation_token=?4",
                params![
                    &reservation.run_id,
                    MEMBER_REWAKE,
                    &reservation.member_id,
                    &reservation.token,
                ],
            )
            .map_err(|err| err.to_string())?;
        }
        tx.commit().map_err(|err| err.to_string())?;
        Ok(true)
    })
}

#[cfg(test)]
pub fn test_only_mark_failed_rewake_attempt(run_id: &str, member_id: &str) -> Result<bool, String> {
    let fingerprint = member_rewake_fingerprint(run_id, member_id, SessionStatus::Failed)?;
    if !delayed_rewake_allowed(run_id, member_id, SessionStatus::Failed, &fingerprint)? {
        return Ok(false);
    }
    record_attempt(run_id, MEMBER_REWAKE, member_id, &fingerprint)?;
    Ok(true)
}

fn delayed_rewake_allowed(
    run_id: &str,
    member_id: &str,
    _status: SessionStatus,
    fingerprint: &str,
) -> Result<bool, String> {
    Ok(matches!(
        budget_disposition(run_id, MEMBER_REWAKE, member_id, fingerprint)?,
        BudgetDisposition::Allowed
    ))
}

/// Non-mutating budget probe: `true` once every rewake attempt for the
/// `(run, member)` pair has been consumed. Distinct from "currently in a
/// backoff window": an exhausted budget never recovers without a
/// successful member turn (which clears it), so it marks the member as
/// beyond autonomous recovery.
fn rewake_budget_exhausted(
    run_id: &str,
    member_id: &str,
    fingerprint: &str,
) -> Result<bool, String> {
    Ok(matches!(
        budget_disposition(run_id, MEMBER_REWAKE, member_id, fingerprint)?,
        BudgetDisposition::Exhausted
    ))
}

fn reason_fingerprint(reason: &str) -> String {
    blake3::hash(reason.as_bytes()).to_hex().to_string()
}

/// Coordinator stall notices for an *unchanged* repair reason back off
/// (1/5/15 min) and stop after [`RECOVERY_DELAYS_SECS`] attempts, so a
/// coordinator that cannot (or will not) repair does not get an
/// unbounded LLM-turn loop every watchdog tick (issue #272 E5). Any
/// change to the reason payload — which every actual repair produces,
/// since it mutates task state — resets the budget.
#[cfg(test)]
fn coordinator_notice_allowed(run_id: &str, reason: &str) -> Result<bool, String> {
    let fingerprint = reason_fingerprint(reason);
    if !coordinator_notice_budget_allows(run_id, &fingerprint)? {
        return Ok(false);
    }
    record_attempt(run_id, COORDINATOR_NOTICE, "coordinator", &fingerprint)?;
    Ok(true)
}

fn coordinator_notice_budget_allows(run_id: &str, fingerprint: &str) -> Result<bool, String> {
    Ok(matches!(
        budget_disposition(run_id, COORDINATOR_NOTICE, "coordinator", fingerprint)?,
        BudgetDisposition::Allowed
    ))
}

pub(crate) fn member_rewake_fingerprint(
    run_id: &str,
    member_id: &str,
    status: SessionStatus,
) -> Result<String, String> {
    Ok(member_rewake_fingerprint_from_unread(
        status,
        AgentInboxStore::unread_fingerprint_for_member(member_id, run_id)?.as_deref(),
    ))
}

fn member_rewake_fingerprint_from_unread(
    status: SessionStatus,
    unread_fingerprint: Option<&str>,
) -> String {
    unread_fingerprint
        .map(|unread| format!("unread:{unread}"))
        .unwrap_or_else(|| format!("status:{}", status.as_str()))
}

/// Recovery actions the watchdog decided on for one quiescent run.
///
/// Unlike the previous four-state enum, actions are not mutually
/// exclusive: one tick may redeliver concrete member input AND escalate an
/// unrelated stale or unassigned task to the coordinator.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StallRecoveryPlan {
    /// Idle/terminal members to wake for unread inbox rows (missed
    /// delivery). May include
    /// [`COORDINATOR_MEMBER_ID`] for coordinator missed deliveries.
    pub wake_member_ids: Vec<String>,
    /// Terminal members that still own open work. The executor persists one
    /// concrete continuation message before waking them; ownership alone is
    /// never used as model input.
    pub continuation_actions: Vec<MemberContinuationAction>,
    /// Ready, owned Pending tasks whose original TaskAssigned delivery was
    /// lost. The executor recreates the typed assignment before waking.
    pub assignment_actions: Vec<MemberTaskAssignmentAction>,
    /// Human-readable repair reasons for the coordinator, one per
    /// stalled task. `Some` only when the coordinator has no unread
    /// inbox rows (an unread notice already covers redelivery via
    /// `wake_member_ids`).
    pub coordinator_repair_reason: Option<String>,
    /// Stable hash of the repair state keys used to reset the notice budget
    /// when the underlying stalled board changes.
    pub coordinator_repair_fingerprint: Option<String>,
    /// Every task resolved + every worker terminal: the run can be
    /// reconciled to a terminal status.
    pub terminal_candidate: bool,
}

impl StallRecoveryPlan {
    pub fn is_noop(&self) -> bool {
        self.wake_member_ids.is_empty()
            && self.continuation_actions.is_empty()
            && self.assignment_actions.is_empty()
            && self.coordinator_repair_reason.is_none()
            && self.coordinator_repair_fingerprint.is_none()
            && !self.terminal_candidate
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberContinuationAction {
    pub member_id: String,
    pub recipient_agent_id: String,
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberTaskAssignmentAction {
    pub member_id: String,
    pub recipient_agent_id: String,
    pub task_ids: Vec<String>,
}

fn ready_unassigned_repair_reason(task: &Task) -> String {
    let mut eligible = agent_org_tasks::eligible_member_ids(task);
    eligible.sort();
    if eligible.is_empty() {
        format!(
            "task {} is ready but has no owner and no eligible_member_ids. Repair eligibility, then choose an explicit owner_member_id; workers cannot self-claim it.",
            task.id
        )
    } else {
        format!(
            "task {} is ready but has no owner. Workers cannot self-claim it; choose an explicit owner_member_id from eligible_member_ids [{}].",
            task.id,
            eligible.join(", ")
        )
    }
}

pub fn spawn(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(WATCHDOG_INTERVAL_SECS));
        // A slow scan must not be "repaid" with back-to-back burst
        // ticks afterwards; the next scheduled tick is enough.
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let handle = app_handle.clone();
            match tokio::task::spawn_blocking(move || recover_all_stalled_runs(handle)).await {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    tracing::warn!(error = %err, "[agent_org_watchdog] watchdog scan failed")
                }
                Err(err) => {
                    tracing::warn!(error = %err, "[agent_org_watchdog] watchdog task join failed")
                }
            }
        }
    });
}

fn recover_all_stalled_runs(app_handle: AppHandle) -> Result<(), String> {
    let runs = AgentOrgRunStore::list_running_runs(usize::MAX)?;
    run_best_effort_cleanup("prune recovery budgets", prune_recovery_budgets);
    run_best_effort_cleanup("cancel stale plan approvals", || {
        AgentOrgPlanApprovalStore::cancel_pending_for_terminal_or_missing_runs().map(|_| ())
    });
    recover_listed_runs(app_handle, runs, recover_stalled_run)
}

/// Auxiliary cleanup is useful but cannot be a global recovery gate. One bad
/// row must not prevent healthy runs from being inspected during this tick.
fn run_best_effort_cleanup(label: &'static str, cleanup: impl FnOnce() -> Result<(), String>) {
    if let Err(err) = cleanup() {
        tracing::warn!(
            cleanup = label,
            error = %err,
            "[agent_org_watchdog] maintenance failed; continuing run scan"
        );
    }
}

fn recover_listed_runs<H: Clone, T>(
    handle: H,
    runs: Vec<AgentOrgRunRecord>,
    mut recover: impl FnMut(H, &str) -> Result<T, String>,
) -> Result<(), String> {
    let mut failed_run_ids = Vec::new();
    for run in runs {
        if let Err(err) = recover(handle.clone(), &run.id) {
            tracing::warn!(
                run_id = %run.id,
                error = %err,
                "[agent_org_watchdog] recovery failed for one run; continuing scan"
            );
            failed_run_ids.push(run.id);
        }
    }
    if failed_run_ids.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{} Agent Org run(s) failed recovery inspection: {}",
            failed_run_ids.len(),
            failed_run_ids.join(", ")
        ))
    }
}

/// Drop budget entries whose run is no longer running so the
/// process-global maps cannot grow unbounded over the app lifetime
/// (issue #272 E6). Paused runs also lose their entries; resuming one
/// intentionally grants a fresh set of recovery attempts.
fn prune_recovery_budgets() -> Result<(), String> {
    with_sessions_writer(|| {
        let conn = get_connection().map_err(|err| err.to_string())?;
        conn.execute(
            "DELETE FROM agent_org_recovery_attempts
             WHERE NOT EXISTS (
                 SELECT 1 FROM agent_org_runs run
                 WHERE run.id = agent_org_recovery_attempts.org_run_id
                   AND run.status = ?1
             )",
            params![AgentOrgRunStatus::Running.as_str()],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    })
}

pub fn recover_stalled_run(
    app_handle: AppHandle,
    run_id: &str,
) -> Result<StallRecoveryPlan, String> {
    let plan = inspect_stalled_run(run_id)?;

    // Reconcile first: when the run actually closes there is nothing
    // left to wake or repair. When reconciliation declines (e.g. the
    // coordinator root session is still open), fall through and deliver
    // the wakes so pending inbox rows still reach their recipients.
    if plan.terminal_candidate {
        let reconciled = AgentOrgRunStore::reconcile_run_finality(run_id)?;
        if reconciled.is_some_and(|status| status != AgentOrgRunStatus::Running) {
            return Ok(plan);
        }
    }

    if AgentOrgRunStore::get_run_status(run_id)? == Some(AgentOrgRunStatus::Running) {
        let recovery_tasks = agent_org_tasks::AgentOrgTaskStore::list(run_id)?;
        for action in &plan.assignment_actions {
            if has_unread_for_member(run_id, &action.member_id)? {
                continue;
            }
            for task_id in &action.task_ids {
                let Some(task) = recovery_tasks.iter().find(|task| &task.id == task_id) else {
                    continue;
                };
                let ready = task.status == TaskStatus::Pending
                    && task.owner.as_deref() == Some(action.member_id.as_str())
                    && task.blocked_by.iter().all(|blocker_id| {
                        recovery_tasks
                            .iter()
                            .find(|candidate| &candidate.id == blocker_id)
                            .is_some_and(|candidate| candidate.status.is_resolved())
                    });
                if ready {
                    agent_org_tasks::enqueue_task_assigned_to(
                        task,
                        &action.recipient_agent_id,
                        &action.member_id,
                        SYSTEM_SENDER_ID,
                        None,
                        "Agent Org recovery",
                    )?;
                }
            }
        }
        for action in &plan.continuation_actions {
            if has_unread_for_member(run_id, &action.member_id)? {
                continue;
            }
            AgentInboxStore::insert(InsertInboxParams {
                recipient_agent_id: action.recipient_agent_id.clone(),
                recipient_member_id: Some(action.member_id.clone()),
                sender_agent_id: SYSTEM_SENDER_ID.to_string(),
                sender_member_id: None,
                org_run_id: Some(run_id.to_string()),
                message: AgentMessage::Plain {
                    summary: "Retry assigned Agent Org work".to_string(),
                    text: format!(
                        "A previous turn ended before your owned task(s) were resolved. Continue only these durable task ids: {}. Refresh task_list/task_get first, then update each task from its current state. Do not create replacement duplicates.",
                        action.task_ids.join(", ")
                    ),
                },
            })?;
        }
    }

    if !plan.wake_member_ids.is_empty() {
        let wake_hook = AppHandleInboxWakeHook::new(app_handle.clone());
        for member_id in &plan.wake_member_ids {
            wake_hook.wake_member(member_id, run_id);
        }
    }

    if let Some(reason) = plan.coordinator_repair_reason.as_deref() {
        let fingerprint = plan
            .coordinator_repair_fingerprint
            .as_deref()
            .unwrap_or(reason);
        if coordinator_notice_budget_allows(run_id, fingerprint)? {
            if insert_coordinator_stall_notice(run_id, reason)? {
                record_attempt(run_id, COORDINATOR_NOTICE, "coordinator", fingerprint)?;
                AppHandleInboxWakeHook::new(app_handle).wake_member(COORDINATOR_MEMBER_ID, run_id);
            }
        } else {
            tracing::debug!(
                run_id = %run_id,
                "[agent_org_watchdog] coordinator stall notice suppressed by budget (reason unchanged)"
            );
        }
    }

    Ok(plan)
}

pub fn inspect_stalled_run(run_id: &str) -> Result<StallRecoveryPlan, String> {
    if AgentOrgRunStore::get_run_status(run_id)? != Some(AgentOrgRunStatus::Running) {
        return Ok(StallRecoveryPlan::default());
    }

    let finality_assessment = AgentOrgRunStore::assess_run_finality(run_id)?;
    let tasks = agent_org_tasks::AgentOrgTaskStore::list(run_id)?;
    let task_graph = agent_org_tasks::TaskGraphIndex::new(&tasks);
    let pending_plan_task_ids = AgentOrgPlanApprovalStore::list_pending_by_run(run_id)?
        .into_iter()
        .map(|approval| approval.source_task_id)
        .collect::<HashSet<_>>();
    let workers = AgentOrgRunStore::list_descendant_worker_sessions(run_id)?;
    let has_active_worker = workers.iter().any(|worker| is_active_status(worker.status));

    let mut member_status = HashMap::new();
    let mut member_updated_at = HashMap::new();
    let mut unsupported_transport_members = HashSet::new();
    for worker in &workers {
        if let Some(member_id) = worker.member_id.as_deref() {
            member_status.insert(member_id.to_string(), worker.status);
            member_updated_at.insert(member_id.to_string(), worker.updated_at.clone());
            if worker.cli_agent_type.is_some() {
                unsupported_transport_members.insert(member_id.to_string());
            }
        }
    }

    // E3 remains intentionally run-level for automated member recovery: while
    // any worker is active, do not wake peers or reassign/claim work. The one
    // safe exception is an observation-only coordinator notice for a Running
    // owner whose task and session timestamps are stale (or corrupt). Age is
    // never used to steal ownership.
    if has_active_worker {
        let mut reasons = Vec::new();
        let mut keys = Vec::new();
        for task in &tasks {
            let Some(owner) = task.owner.as_deref() else {
                let ready = task.status == TaskStatus::Pending && task_graph.is_ready(task);
                if ready {
                    let mut eligible = agent_org_tasks::eligible_member_ids(task);
                    eligible.sort();
                    keys.push(format!(
                        "awaiting_coordinator_assignment:{}:{}",
                        task.id,
                        eligible.join(",")
                    ));
                    reasons.push(ready_unassigned_repair_reason(task));
                }
                continue;
            };
            if unsupported_transport_members.contains(owner) && !task.status.is_resolved() {
                keys.push(format!("unsupported_transport:{}:{}", task.id, owner));
                reasons.push(format!(
                    "task {} is owned by historical CLI member {}, whose Agent Org transport is unsupported; reassign it to a Rust member.",
                    task.id, owner
                ));
                continue;
            }
            if pending_plan_task_ids.contains(&task.id)
                || task.status != TaskStatus::InProgress
                || member_status.get(owner) != Some(&SessionStatus::Running)
                || !is_stale_in_progress(task.updated_at.as_str(), member_updated_at.get(owner))
                || has_unread_for_member(run_id, owner)?
            {
                continue;
            }
            keys.push(format!("stale_running_owner:{}:{}", task.id, owner));
            reasons.push(format!(
                "task {} is still in_progress under Running member {} but appears stale; the watchdog will not steal it based on age. Ask the owner to continue/retry or explicitly reassign it.",
                task.id, owner
            ));
        }
        keys.sort();
        return Ok(StallRecoveryPlan {
            wake_member_ids: Vec::new(),
            continuation_actions: Vec::new(),
            assignment_actions: Vec::new(),
            coordinator_repair_reason: (!reasons.is_empty()).then(|| reasons.join("\n")),
            coordinator_repair_fingerprint: (!keys.is_empty())
                .then(|| reason_fingerprint(&keys.join("|"))),
            terminal_candidate: false,
        });
    }

    // One task-list scan identifies ownerless work that is ready for an
    // explicit coordinator assignment. It is never a Worker wake reason.
    let ready_unassigned_task_ids: HashSet<String> =
        agent_org_tasks::ready_unassigned_tasks(&tasks)
            .into_iter()
            .map(|task| task.id.clone())
            .collect();
    let assignment_conn = get_connection().map_err(|err| err.to_string())?;
    let historically_assigned_task_ids =
        AgentInboxStore::task_assignment_ids_for_open_tasks_with_connection(
            &assignment_conn,
            run_id,
        )?;
    let mut owned_open_tasks_by_member: HashMap<&str, Vec<String>> = HashMap::new();
    let mut ready_pending_tasks_by_member: HashMap<&str, Vec<String>> = HashMap::new();
    for task in &tasks {
        if task.status.is_resolved() || pending_plan_task_ids.contains(&task.id) {
            continue;
        }
        if let Some(owner) = task.owner.as_deref() {
            owned_open_tasks_by_member
                .entry(owner)
                .or_default()
                .push(task.id.clone());
            if task.status == TaskStatus::Pending
                && !historically_assigned_task_ids.contains(&task.id)
                && task_graph.is_ready(task)
            {
                ready_pending_tasks_by_member
                    .entry(owner)
                    .or_default()
                    .push(task.id.clone());
            }
        }
    }
    // Wake pass (issue #272 E2). "Idle with unread inbox" is the
    // canonical missed-wake state, so it is a wake reason — not a skip
    // condition — and members are gated individually instead of the
    // previous all-or-nothing unread check.
    let mut wake_member_ids: Vec<String> = Vec::new();
    let mut continuation_actions = Vec::new();
    let mut assignment_actions = Vec::new();
    for worker in &workers {
        let Some(member_id) = worker.member_id.as_deref() else {
            continue;
        };
        if !is_wakeable_status(worker.status) {
            continue;
        }
        if unsupported_transport_members.contains(member_id) {
            continue;
        }
        if wake_member_ids.iter().any(|existing| existing == member_id) {
            continue;
        }
        let has_unread = has_unread_for_member(run_id, member_id)?;
        let continuation_task_ids = owned_open_tasks_by_member.get(member_id);
        let assignment_task_ids = ready_pending_tasks_by_member.get(member_id);
        let needs_assignment = assignment_task_ids.is_some_and(|task_ids| !task_ids.is_empty());
        let in_progress_continuation_task_ids = continuation_task_ids
            .map(|task_ids| {
                task_ids
                    .iter()
                    .filter(|task_id| {
                        tasks.iter().any(|task| {
                            &task.id == *task_id
                                && (task.status == TaskStatus::InProgress
                                    || (task.status == TaskStatus::Pending
                                        && historically_assigned_task_ids.contains(&task.id)))
                        })
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let needs_terminal_continuation =
            worker.status.is_terminal() && !in_progress_continuation_task_ids.is_empty();
        if !has_unread && !needs_assignment && !needs_terminal_continuation {
            continue;
        }
        let rewake_fingerprint = member_rewake_fingerprint(run_id, member_id, worker.status)?;
        if !delayed_rewake_allowed(run_id, member_id, worker.status, &rewake_fingerprint)? {
            continue;
        }
        if !has_unread && needs_assignment {
            let Some(recipient_agent_id) = worker.agent_definition_id.clone() else {
                continue;
            };
            assignment_actions.push(MemberTaskAssignmentAction {
                member_id: member_id.to_string(),
                recipient_agent_id,
                task_ids: assignment_task_ids.cloned().unwrap_or_default(),
            });
        } else if !has_unread && needs_terminal_continuation {
            let Some(recipient_agent_id) = worker.agent_definition_id.clone() else {
                continue;
            };
            continuation_actions.push(MemberContinuationAction {
                member_id: member_id.to_string(),
                recipient_agent_id,
                task_ids: in_progress_continuation_task_ids,
            });
        }
        wake_member_ids.push(member_id.to_string());
    }

    // Coordinator missed-delivery recovery: an unread coordinator inbox
    // row with a quiescent coordinator session means a wake was lost
    // (e.g. dropped at shutdown). Redeliver instead of inserting more
    // notices on top of it.
    let coordinator_unread = has_unread_for_member(run_id, COORDINATOR_MEMBER_ID)?;
    if coordinator_unread {
        if let Some(info) =
            AgentOrgRunStore::find_coordinator_session_by_member_id(run_id, COORDINATOR_MEMBER_ID)?
        {
            let rewake_fingerprint =
                member_rewake_fingerprint(run_id, COORDINATOR_MEMBER_ID, info.status)?;
            if is_wakeable_status(info.status)
                && delayed_rewake_allowed(
                    run_id,
                    COORDINATOR_MEMBER_ID,
                    info.status,
                    &rewake_fingerprint,
                )?
            {
                wake_member_ids.push(COORDINATOR_MEMBER_ID.to_string());
            }
        }
    }

    let mut needs_repair = Vec::new();
    let mut repair_keys = Vec::new();
    for task in &tasks {
        if task.status.is_resolved() {
            continue;
        }
        if let Some(owner) = task.owner.as_deref() {
            let owner_status = member_status.get(owner).copied();
            if unsupported_transport_members.contains(owner) {
                repair_keys.push(format!("unsupported_transport:{}:{}", task.id, owner));
                needs_repair.push(format!(
                    "task {} is owned by historical CLI member {}, whose Agent Org transport is unsupported; reassign owner_member_id to a Rust member",
                    task.id, owner
                ));
            } else if owner_status.is_none() || owner_status == Some(SessionStatus::Archived) {
                repair_keys.push(format!("missing_owner:{}:{}", task.id, owner));
                needs_repair.push(format!(
                    "task {} is owned by unavailable member {}; reassign owner_member_id or repair eligible_member_ids",
                    task.id, owner
                ));
            } else if match owner_status {
                Some(status) if status.is_terminal() => rewake_budget_exhausted(
                    run_id,
                    owner,
                    &member_rewake_fingerprint(run_id, owner, status)?,
                )?,
                _ => false,
            } {
                repair_keys.push(format!("terminal_owner:{}:{}", task.id, owner));
                needs_repair.push(format!(
                    "task {} is owned by terminal member {} whose automatic retry budget is exhausted; retry the owner, reassign owner_member_id, or repair eligible_member_ids",
                    task.id, owner
                ));
            } else if task.status == TaskStatus::InProgress
                && !pending_plan_task_ids.contains(&task.id)
                && is_stale_in_progress(task.updated_at.as_str(), member_updated_at.get(owner))
                && !has_unread_for_member(run_id, owner)?
            {
                repair_keys.push(format!("stale_owner:{}:{}", task.id, owner));
                let eligible = agent_org_tasks::eligible_member_ids(task);
                let eligible = if eligible.is_empty() {
                    "none".to_string()
                } else {
                    eligible.join(", ")
                };
                needs_repair.push(format!(
                    "task {} is still in_progress under member {} but appears stale; task_updated_at={}, owner_updated_at={}, eligible_member_ids=[{}]. The watchdog does not steal work from a Running member based on age alone. Ask the owner to continue/retry, reassign owner_member_id, or repair eligible_member_ids.",
                    task.id,
                    owner,
                    task.updated_at,
                    member_updated_at
                        .get(owner)
                        .map(String::as_str)
                        .unwrap_or("unknown"),
                    eligible
                ));
            } else if task.status == TaskStatus::Pending
                && historically_assigned_task_ids.contains(&task.id)
                && owner_status == Some(SessionStatus::Idle)
                && is_stale_in_progress(task.updated_at.as_str(), member_updated_at.get(owner))
                && !has_unread_for_member(run_id, owner)?
            {
                repair_keys.push(format!(
                    "consumed_assignment_without_start:{}:{}",
                    task.id, owner
                ));
                needs_repair.push(format!(
                    "task {} was assigned to member {}, its assignment was consumed, but the task never entered in_progress. Ask the owner for status or explicitly retry/reassign it.",
                    task.id, owner
                ));
            }
            continue;
        }
        if task.status != TaskStatus::Pending {
            continue;
        }
        if !ready_unassigned_task_ids.contains(task.id.as_str()) {
            // Blocked on other work; nothing to recover yet.
            continue;
        }
        let eligible_member_ids = agent_org_tasks::eligible_member_ids(task);
        let mut stable_eligible = eligible_member_ids.clone();
        stable_eligible.sort();
        repair_keys.push(format!(
            "awaiting_coordinator_assignment:{}:{}",
            task.id,
            stable_eligible.join(",")
        ));
        needs_repair.push(ready_unassigned_repair_reason(task));
    }

    // A terminal reconciliation may legitimately decline even when every
    // Task is resolved (for example, the coordinator has not observed the
    // latest work revision). Convert the actionable canonical blockers into
    // one bounded coordinator repair instead of returning an empty plan that
    // leaves the run permanently Running.
    for blocker in &finality_assessment.blockers {
        match blocker {
            AgentOrgFinalityBlocker::EmptyTaskBoardRequiresCompletionIntent => {
                repair_keys.push("empty_board_requires_completion_intent".to_string());
                needs_repair.push(
                    "the Agent Org task board is empty. If the mission truly needs no durable tasks, call org_run_complete with a concise summary; otherwise create the missing task graph."
                        .to_string(),
                );
            }
            AgentOrgFinalityBlocker::StaleCompletionIntent {
                requested_work_revision,
                current_work_revision,
            } => {
                repair_keys.push(format!(
                    "stale_completion_intent:{requested_work_revision:?}:{current_work_revision}"
                ));
                needs_repair.push(format!(
                    "the previous completion request observed work revision {requested_work_revision:?}, but the board is now revision {current_work_revision}. Re-inspect the board before calling org_run_complete again."
                ));
            }
            AgentOrgFinalityBlocker::CoordinatorHasNotObservedLatestWork {
                observed_work_revision,
                current_work_revision,
            } if tasks.iter().all(|task| task.status.is_resolved()) => {
                repair_keys.push(format!(
                    "coordinator_observation:{observed_work_revision:?}:{current_work_revision}"
                ));
                needs_repair.push(format!(
                    "all durable tasks are resolved, but the coordinator has only observed work revision {observed_work_revision:?}; the current revision is {current_work_revision}. Refresh task_list and produce the final user-facing synthesis."
                ));
            }
            _ => {}
        }
    }

    let coordinator_repair_reason = if !needs_repair.is_empty() && !coordinator_unread {
        Some(needs_repair.join("\n"))
    } else {
        None
    };
    repair_keys.sort();
    let coordinator_repair_fingerprint = coordinator_repair_reason
        .as_ref()
        .map(|_| reason_fingerprint(&repair_keys.join("|")));

    let terminal_candidate = matches!(
        finality_assessment.decision,
        AgentOrgFinalityDecision::Complete | AgentOrgFinalityDecision::Abandon
    );

    Ok(StallRecoveryPlan {
        wake_member_ids,
        continuation_actions,
        assignment_actions,
        coordinator_repair_reason,
        coordinator_repair_fingerprint,
        terminal_candidate,
    })
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
    let stale_before =
        Utc::now() - ChronoDuration::seconds(agent_org_tasks::STALE_MEMBER_NOTICE_SECS);
    let task_updated_at = match DateTime::parse_from_rfc3339(task_updated_at) {
        Ok(parsed) => parsed.with_timezone(&Utc),
        Err(err) => {
            // Corrupt timestamps must escalate, not silently exempt the
            // task from staleness forever (issue #272 E6). The notice
            // budget caps any resulting repeat noise.
            tracing::warn!(
                timestamp = %task_updated_at,
                error = %err,
                "[agent_org_watchdog] unparseable task updated_at; treating task as stale"
            );
            return true;
        }
    };
    if task_updated_at > stale_before {
        return false;
    }
    let Some(owner_updated_at) = owner_updated_at else {
        return true;
    };
    match DateTime::parse_from_rfc3339(owner_updated_at) {
        Ok(parsed) => parsed.with_timezone(&Utc) <= stale_before,
        Err(err) => {
            tracing::warn!(
                timestamp = %owner_updated_at,
                error = %err,
                "[agent_org_watchdog] unparseable owner updated_at; treating task as stale"
            );
            true
        }
    }
}

fn has_unread_for_member(run_id: &str, member_id: &str) -> Result<bool, String> {
    AgentInboxStore::has_unread_for_member(member_id, run_id)
}

fn insert_coordinator_stall_notice(run_id: &str, reason: &str) -> Result<bool, String> {
    if AgentOrgRunStore::get_run_status(run_id)? != Some(AgentOrgRunStatus::Running) {
        return Ok(false);
    }
    let store = crate::definitions::orgs::orgs_store();
    let Some(context) = AgentOrgRunStore::context_for_run(run_id, &store)? else {
        return Ok(false);
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
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordination::agent_org_runs::{AgentOrgRunEntryMode, AgentOrgRunRecord};

    fn fake_run(id: &str) -> AgentOrgRunRecord {
        let now = Utc::now().to_rfc3339();
        AgentOrgRunRecord {
            id: id.to_string(),
            org_id: "org".to_string(),
            coordinator_agent_id: "coordinator-agent".to_string(),
            root_session_id: Some(format!("root-{id}")),
            org_snapshot_json: None,
            entry_mode: AgentOrgRunEntryMode::StandaloneSession,
            status: AgentOrgRunStatus::Running,
            work_item_id: None,
            project_slug: None,
            routine_fire_id: None,
            summary: None,
            last_error: None,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
        }
    }

    #[test]
    fn wakeable_status_includes_idle_and_terminal_but_not_running() {
        assert!(is_wakeable_status(SessionStatus::Idle));
        assert!(is_wakeable_status(SessionStatus::Failed));
        assert!(!is_wakeable_status(SessionStatus::Running));
    }

    #[test]
    fn member_rewake_reservation_is_atomic_and_refundable() {
        let _sandbox = test_helpers::test_env::sandbox();
        let conn = get_connection().expect("db");
        init_schema(&conn).expect("schema");
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let member_id = "member-reserved";
        let fingerprint = "unread-42";

        let first = match reserve_member_rewake_dispatch(&run_id, member_id, fingerprint)
            .expect("reserve first dispatch")
        {
            MemberRewakeReservationOutcome::Reserved(reservation) => reservation,
            MemberRewakeReservationOutcome::Deferred => panic!("first dispatch must reserve"),
        };
        assert!(matches!(
            reserve_member_rewake_dispatch(&run_id, member_id, fingerprint)
                .expect("concurrent reservation gate"),
            MemberRewakeReservationOutcome::Deferred
        ));
        assert!(refund_member_rewake_reservation(&first).expect("refund failed dispatch"));
        assert!(matches!(
            reserve_member_rewake_dispatch(&run_id, member_id, fingerprint)
                .expect("reserve after refund"),
            MemberRewakeReservationOutcome::Reserved(_)
        ));
    }

    #[test]
    fn stale_rewake_refund_cannot_undo_newer_input() {
        let _sandbox = test_helpers::test_env::sandbox();
        let conn = get_connection().expect("db");
        init_schema(&conn).expect("schema");
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let member_id = "member-new-input";
        let old = match reserve_member_rewake_dispatch(&run_id, member_id, "unread-1")
            .expect("reserve old fingerprint")
        {
            MemberRewakeReservationOutcome::Reserved(reservation) => reservation,
            MemberRewakeReservationOutcome::Deferred => panic!("old fingerprint must reserve"),
        };
        let current = match reserve_member_rewake_dispatch(&run_id, member_id, "unread-2")
            .expect("new durable input resets budget")
        {
            MemberRewakeReservationOutcome::Reserved(reservation) => reservation,
            MemberRewakeReservationOutcome::Deferred => {
                panic!("new fingerprint must have its own reservation")
            }
        };

        assert!(
            !refund_member_rewake_reservation(&old).expect("stale refund"),
            "an old dispatch token must not roll back newer durable input"
        );
        commit_member_rewake_reservation(&current).expect("commit current dispatch");
        assert_eq!(
            budget_disposition(&run_id, MEMBER_REWAKE, member_id, "unread-2").expect("read budget"),
            BudgetDisposition::Backoff
        );
    }

    #[test]
    fn one_failed_run_does_not_skip_later_runs() {
        let first = fake_run("run-first");
        let second = fake_run("run-second");
        let mut inspected = Vec::new();

        let error = recover_listed_runs((), vec![first, second], |(), run_id| {
            inspected.push(run_id.to_string());
            if run_id == "run-first" {
                Err("injected failure".to_string())
            } else {
                Ok(())
            }
        })
        .expect_err("aggregate error");

        assert!(error.contains("run-first"));
        assert_eq!(inspected, vec!["run-first", "run-second"]);
    }

    #[test]
    fn maintenance_failure_is_best_effort() {
        run_best_effort_cleanup("injected", || Err("failure".to_string()));
    }

    #[test]
    fn coordinator_notice_budget_backs_off_and_resets_on_new_reason() {
        let _sandbox = test_helpers::test_env::sandbox();
        let conn = get_connection().expect("db");
        init_schema(&conn).expect("schema");
        let run_id = format!("run-{}", uuid::Uuid::new_v4());

        assert!(coordinator_notice_allowed(&run_id, "task a stuck").expect("notice"));
        assert!(!coordinator_notice_allowed(&run_id, "task a stuck").expect("backoff"));
        assert!(coordinator_notice_allowed(&run_id, "task b stuck").expect("new reason"));
    }
}
