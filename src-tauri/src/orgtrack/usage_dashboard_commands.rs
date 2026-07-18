//! Tauri commands for the Usage dashboard (chat pane → Runtime → Usage).
//!
//! Thin wrappers over [`orgtrack_core::usage_dashboard`] — read-only rollups of
//! the local session DB (`~/.orgii/sessions.db`). No scanning, no proxy: they
//! only aggregate what the existing pipeline already stored. Per-call drill-in
//! is served by the existing `get_session_llm_usage_spans` /
//! `get_session_tool_usage_attributions` commands, not here.

use database::db::get_connection;
use orgtrack_core::usage_dashboard::{
    self, SessionSort, TrendBucket, UsageFilter, UsageSessionRow, UsageSummary, UsageTrendPoint,
};

const DAY_MS: i64 = 86_400_000;
/// Sessions-table page cap, so a huge history can't return an unbounded blob.
const MAX_SESSION_ROWS: usize = 1_000;

fn open_conn() -> Result<rusqlite::Connection, String> {
    get_connection().map_err(|err| format!("Failed to open sessions DB: {err}"))
}

fn build_filter(bucket: Option<String>, start_ms: Option<i64>, end_ms: Option<i64>) -> UsageFilter {
    UsageFilter {
        // Treat blank/"all" as no bucket filter (the four scoped buckets).
        bucket: bucket.filter(|value| !value.is_empty() && value != "all"),
        start_ms,
        end_ms,
    }
}

/// Choose hourly vs daily buckets: hourly for windows up to ~24h (matching the
/// reference dashboard), daily otherwise. An open-ended window defaults to days.
fn resolve_trend_bucket(
    explicit: Option<&str>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> TrendBucket {
    match explicit {
        Some("hour") => return TrendBucket::Hour,
        Some("day") => return TrendBucket::Day,
        _ => {}
    }
    match (start_ms, end_ms) {
        (Some(start), Some(end)) if end.saturating_sub(start) <= DAY_MS => TrendBucket::Hour,
        _ => TrendBucket::Day,
    }
}

/// Headline totals (tokens, cost, cache-hit rate, per-bucket breakdown) for the
/// current scope.
#[tauri::command]
pub async fn usage_dashboard_summary(
    bucket: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<UsageSummary, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_conn()?;
        let filter = build_filter(bucket, start_ms, end_ms);
        usage_dashboard::usage_summary(&conn, &filter)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Time-bucketed token + cost series for the trends chart.
#[tauri::command]
pub async fn usage_dashboard_trends(
    bucket: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    bucket_unit: Option<String>,
) -> Result<Vec<UsageTrendPoint>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_conn()?;
        let filter = build_filter(bucket, start_ms, end_ms);
        let unit = resolve_trend_bucket(bucket_unit.as_deref(), start_ms, end_ms);
        usage_dashboard::usage_trends(&conn, &filter, unit)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Per-session table rows for the current scope, sorted and paginated. The row
/// total for pagination is `usage_dashboard_summary`'s `sessionCount`.
#[tauri::command]
pub async fn usage_dashboard_sessions(
    bucket: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    sort: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<UsageSessionRow>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_conn()?;
        let filter = build_filter(bucket, start_ms, end_ms);
        let sort = SessionSort::parse(sort.as_deref());
        let offset = offset.unwrap_or(0);
        let limit = limit.unwrap_or(MAX_SESSION_ROWS).min(MAX_SESSION_ROWS);
        usage_dashboard::usage_sessions(&conn, &filter, sort, offset, limit)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}
