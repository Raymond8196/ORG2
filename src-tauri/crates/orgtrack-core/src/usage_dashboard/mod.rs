//! Cross-session usage/cost aggregation for the Usage dashboard.
//!
//! Read-only rollups over the per-session projection
//! (`orgtrack_core_session_usage`, see [`crate::session_usage`]) plus the
//! underlying token stores. No writes, no schema changes. Three read shapes:
//! a headline [`UsageSummary`], a time-bucketed [`UsageTrendPoint`] series, and
//! a per-session [`UsageSessionRow`] table. Per-call drill-in is served by the
//! existing `session_llm_usage_spans` / `session_tool_usage` read commands and
//! is not computed here.
//!
//! Invariants the math depends on:
//!
//! - **No double-count.** A native managed session and its imported mirror
//!   project under *different* session_ids (the mirror carries
//!   `imported_history_session_cache.listable = 0`). Every rollup excludes
//!   mirror rows, or native sessions count twice.
//! - **One bucket per session.** Each in-scope session is attributed to exactly
//!   one source bucket derived from the projection `source` +
//!   `code_sessions.cli_agent_type`.
//! - **One trend source per session.** Trends split by the projection's
//!   `tokens_source`: native sessions contribute their per-turn
//!   `session_token_usage` rows (a real curve); imported sessions contribute a
//!   single lumped point at their last-activity time. A session is never in
//!   both halves.
//! - Cost mirrors the projection: `cost_usd` is recorded metered spend when
//!   known, else the list-price estimate (see [`crate::session_usage`]).

mod model;
mod reads;
mod rounds;

#[cfg(test)]
mod tests;

pub use model::*;
pub use reads::*;
