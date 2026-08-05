//! Work application service (`orgtrack/v1` Phase 2a).
//!
//! Single business layer above the atomic store choke point. Every entry
//! point (Tauri commands, agent tools, the future PM CLI, schedulers,
//! sync adapters) is expected to mutate work items through here — not by
//! assembling `WorkItemFrontmatter` rows directly.
//!
//! What lands in 2a:
//! - the portable [`state::WorkItemState`] FSM with legacy-status mapping;
//! - append-only audit + `pm_change_seq` watermark on EVERY atomic
//!   mutation (wired inside `projects::io::work_items::atomic`);
//! - optimistic concurrency (`expected_revision` against `local_version`)
//!   and strict-FSM transitions via [`transition_project_work_item`].
//!
//! Error contract: typed sentinels with the `PM_ERR:` prefix
//! ([`error::REVISION_CONFLICT`], [`error::INVALID_TRANSITION`]) so the
//! Phase 3 CLI layer can map them onto the stable wire error codes
//! without string-guessing. Everything else is an opaque store error.

pub mod audit;
pub mod state;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

pub use state::WorkItemState;

use crate::projects::io as project_io;
use crate::projects::types::{
    LinkedSession, OrchestratorConfig, TodoEntry, WorkItemData, WorkItemFrontmatter,
    WorkItemHandoff, WorkItemMutationActor, WorkItemSchedule,
};

/// Typed error sentinels understood by upper layers.
pub mod error {
    pub const PREFIX: &str = "PM_ERR:";
    pub const REVISION_CONFLICT: &str = "PM_ERR:REVISION_CONFLICT";
    pub const INVALID_TRANSITION: &str = "PM_ERR:INVALID_TRANSITION";

    pub fn revision_conflict(expected: i64, current: i64) -> String {
        format!("{}:{}:{}", REVISION_CONFLICT, expected, current)
    }

    pub fn invalid_transition(from: &str, to: &str) -> String {
        format!("{}:{}:{}", INVALID_TRANSITION, from, to)
    }
}

/// Strict, audited status transition for a project-scoped work item.
///
/// This is the `work.transition` application operation from the frozen
/// contract: it validates the portable FSM (hard reject, not flag-only),
/// honors `expected_revision`, clears the execution lock when the target
/// maps to portable `open` (the release edge), and records the reason in
/// the audit payload. Lifecycle-only: non-lifecycle fields are patch
/// territory.
pub fn transition_project_work_item(
    project_slug: &str,
    short_id: &str,
    to_status: &str,
    reason: Option<&str>,
    actor: Option<&WorkItemMutationActor>,
    expected_revision: Option<i64>,
) -> Result<WorkItemData, String> {
    let to_status_owned = to_status.to_string();
    let reason_owned = reason.map(|value| value.to_string());
    project_io::update_work_item_atomic_serviced(
        project_slug,
        short_id,
        actor,
        project_io::AtomicServiceOptions {
            expected_local_version: expected_revision,
            operation: Some("work.transition"),
            strict_fsm: true,
            reason: reason_owned,
        },
        move |frontmatter, _body| {
            if frontmatter.status == to_status_owned {
                return Err(error::invalid_transition(
                    &frontmatter.status,
                    &to_status_owned,
                ));
            }
            let releases_to_open = matches!(
                state::map_legacy_status(&to_status_owned),
                Some(state::WorkItemState::Open)
            );
            frontmatter.status = to_status_owned.clone();
            if releases_to_open {
                // Release edge (§9.3): entering portable `open` clears the
                // active execution claim so the item is re-claimable.
                frontmatter.execution_lock = None;
            }
            Ok(())
        },
    )?;
    project_io::read_work_item(project_slug, short_id)
}

/// Creation DTO for the canonical `work.create` application operation.
///
/// Deliberately NOT the 32-field `WorkItemFrontmatter`: callers describe
/// the work; the service owns row construction. Short-id allocation stays
/// with the caller because collab-synced orgs mint ids on the server
/// (design §16.5) and that allocator currently lives client-side.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkItemRequest {
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub project_id: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub assignee_type: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub milestone: Option<String>,
    pub parent: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub created_by: Option<String>,
    pub schedule: Option<WorkItemSchedule>,
    pub orchestrator_config: Option<OrchestratorConfig>,
    /// Optional parsed checklist written atomically with creation.
    #[serde(default)]
    pub todos: Vec<TodoEntry>,
    /// Optional human handoff written atomically with initial assignment.
    pub handoff: Option<WorkItemHandoff>,
    /// Durable session provenance written in the same operation.
    #[serde(default)]
    pub linked_sessions: Vec<LinkedSession>,
}

fn build_frontmatter(short_id: &str, request: &CreateWorkItemRequest) -> WorkItemFrontmatter {
    let now = chrono::Utc::now().to_rfc3339();
    WorkItemFrontmatter {
        id: short_id.to_string(),
        short_id: short_id.to_string(),
        title: request.title.clone(),
        project: request.project_id.clone(),
        status: request
            .status
            .clone()
            .unwrap_or_else(|| "backlog".to_string()),
        priority: request
            .priority
            .clone()
            .unwrap_or_else(|| "none".to_string()),
        assignee: request.assignee.clone(),
        assignee_type: request.assignee_type.clone(),
        labels: request.labels.clone(),
        milestone: request.milestone.clone(),
        parent: request.parent.clone(),
        start_date: request.start_date.clone(),
        target_date: request.target_date.clone(),
        created_by: request.created_by.clone(),
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        starred: false,
        todos: request.todos.clone(),
        comments: vec![],
        history: vec![],
        delegations: vec![],
        linked_sessions: request.linked_sessions.clone(),
        handoff: request.handoff.clone(),
        proof_of_work: None,
        orchestrator_config: request.orchestrator_config.clone(),
        orchestrator_state: None,
        follow_up_items: vec![],
        schedule: request.schedule.clone(),
        routine_source: None,
        execution_lock: None,
        close_out: None,
        work_products: vec![],
    }
}

/// Audit a creation. Residual: the audit row commits in its own small
/// transaction right after the insert (the crud write path doesn't take
/// in-tx hooks yet); the crash window between the two is the documented
/// gap that closes when crud converges onto the serviced choke point.
fn audit_create(
    entity_id: &str,
    project_slug: Option<&str>,
    org_id: Option<&str>,
    actor: Option<&WorkItemMutationActor>,
) -> Result<(), String> {
    let mut connection = project_io::helpers::conn()?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("pm audit tx: {}", err))?;
    let seq = audit::bump_change_seq(&tx)?;
    audit::append_audit_event(
        &tx,
        &audit::AuditEventRow {
            operation: "work.create",
            entity_type: "work_item",
            entity_id,
            project_slug,
            org_id,
            actor,
            revision: 0,
            seq,
            payload: serde_json::json!({}),
        },
    )?;
    tx.commit().map_err(|err| format!("pm audit commit: {}", err))
}

/// Canonical `work.create` for a project-scoped item. The single Rust
/// construction site replacing per-caller `WorkItemFrontmatter` literals.
pub fn create_project_work_item(
    project_slug: &str,
    short_id: &str,
    request: &CreateWorkItemRequest,
    actor: Option<&WorkItemMutationActor>,
) -> Result<WorkItemData, String> {
    let frontmatter = build_frontmatter(short_id, request);
    project_io::write_work_item(project_slug, short_id, &frontmatter, &request.body)?;
    audit_create(short_id, Some(project_slug), None, actor)?;
    project_io::read_work_item(project_slug, short_id)
}

/// Canonical `work.create` for an org-scoped standalone item.
pub fn create_standalone_work_item(
    org_id: Option<&str>,
    short_id: &str,
    request: &CreateWorkItemRequest,
    actor: Option<&WorkItemMutationActor>,
) -> Result<WorkItemData, String> {
    let frontmatter = build_frontmatter(short_id, request);
    project_io::write_standalone_work_item(org_id, short_id, &frontmatter, &request.body)?;
    audit_create(short_id, None, org_id, actor)?;
    project_io::read_standalone_work_item(org_id, short_id)
}
