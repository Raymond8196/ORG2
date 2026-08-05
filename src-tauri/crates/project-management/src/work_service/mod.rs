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
use crate::projects::types::{WorkItemData, WorkItemMutationActor};

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
