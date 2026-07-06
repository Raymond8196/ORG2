//! Plan-mode runtime state: disk path resolution + per-session caches.
//!
//! Split into two small modules so tests stay focused:
//! - `paths` — slug/hash/plan-file-path helpers (pure functions)
//! - `state` — `PlanSlotCache` and `PrePlanModeCache` (session-scoped mutables)

pub mod paths;
pub mod state;

// Items kept at the `plan_mode::` surface — checked one by one against
// real call sites:
// - `PlanSlotCache` (`tools::registration` Tauri-managed state)
// - `plan_file_path`, `random_hash`, `slugify_plan_title`, `PlanPathCtx`,
//   `PlanSlot` (flat-imported by `tools::impls::plan_mode::create_plan`)
// - `LastNonPlanModeCache`, `PrePlanModeCache` (flat-imported by
//   `state::session_runtime`)
// - `LastResolvedPlan` + its accessors (written by
//   `interaction::plan_approval`, read by the Plan-mode prompt suffix
//   section for the re-entry note)
// `plan_file_name` and `plans_directory` are reached only via the deeper
// `paths::` segment, so we deliberately do not flatten them.
pub use paths::{plan_file_path, random_hash, slugify_plan_title, PlanPathCtx};
pub use state::{
    clear_last_resolved_plan, last_resolved_plan, record_last_resolved_plan, LastNonPlanModeCache,
    LastResolvedPlan, PlanSlot, PlanSlotCache, PrePlanModeCache, RequestedExecModeCache,
};
