use rusqlite::Connection;
use serde::Serialize;

use super::model::*;
use super::rounds::*;

/// Headline totals for the filter's scope, aggregated from the SAME per-round
/// set as the request log and trends so the three always agree (a session-level
/// summary could disagree with the round table's time filter and blank the
/// panel even when rounds exist).
pub fn usage_summary(conn: &Connection, filter: &UsageFilter) -> Result<UsageSummary, String> {
    Ok(summarize_rounds(&collect_rounds(conn, filter)?))
}

/// Per-session table rows for the filter's scope, sorted and paginated.
pub fn usage_sessions(
    conn: &Connection,
    filter: &UsageFilter,
    sort: SessionSort,
    offset: usize,
    limit: usize,
) -> Result<Vec<UsageSessionRow>, String> {
    let sessions = fetch_scoped_sessions(conn, filter.bucket.as_deref(), filter.all_sources)?;
    let mut rows: Vec<UsageSessionRow> = sessions
        .into_iter()
        .filter(|session| filter.contains(session.last_active_ms))
        .map(|session| UsageSessionRow {
            cache_hit_rate: cache_hit_rate(
                session.input_tokens,
                session.cache_write_tokens,
                session.cache_read_tokens,
            ),
            real_total_tokens: session.real_total_tokens(),
            session_id: session.session_id,
            name: session.name,
            bucket: session.bucket,
            source: session.source,
            model: session.model,
            tokens_source: session.tokens_source,
            input_tokens: session.input_tokens,
            output_tokens: session.output_tokens,
            cache_read_tokens: session.cache_read_tokens,
            cache_write_tokens: session.cache_write_tokens,
            total_tokens: session.total_tokens,
            cost_usd: session.cost_usd,
            estimated_cost_usd: session.estimated_cost_usd,
            recorded_cost_usd: session.recorded_cost_usd,
            turn_count: session.turn_count,
            last_active_ms: session.last_active_ms,
        })
        .collect();

    match sort {
        SessionSort::Cost => rows.sort_by(|a, b| {
            b.cost_usd
                .partial_cmp(&a.cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        SessionSort::Tokens => rows.sort_by_key(|row| std::cmp::Reverse(row.real_total_tokens)),
        SessionSort::Recent => rows.sort_by_key(|row| std::cmp::Reverse(row.last_active_ms)),
    }

    Ok(rows.into_iter().skip(offset).take(limit).collect())
}

/// Per-round request-log rows for the filter's scope, sorted and paginated.
pub fn usage_rounds(
    conn: &Connection,
    filter: &UsageFilter,
    sort: SessionSort,
    offset: usize,
    limit: usize,
) -> Result<Vec<UsageRoundRow>, String> {
    let mut rows = collect_rounds(conn, filter)?;
    sort_rounds(&mut rows, sort);
    Ok(rows.into_iter().skip(offset).take(limit).collect())
}

/// Time-bucketed token + cost series, aggregated from the same per-round set as
/// the request log — a fine curve for every source.
pub fn usage_trends(
    conn: &Connection,
    filter: &UsageFilter,
    bucket_unit: TrendBucket,
) -> Result<Vec<UsageTrendPoint>, String> {
    Ok(bucket_rounds(&collect_rounds(conn, filter)?, bucket_unit))
}

/// Everything the dashboard needs in one shot: summary + trends + the request
/// log page, all from a SINGLE `collect_rounds` pass. The frontend calls this
/// instead of three separate commands, so a refresh scans the round store once
/// (not three times).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOverview {
    pub summary: UsageSummary,
    pub trends: Vec<UsageTrendPoint>,
    pub rounds: Vec<UsageRoundRow>,
}

pub fn usage_overview(
    conn: &Connection,
    filter: &UsageFilter,
    sort: SessionSort,
    offset: usize,
    limit: usize,
    bucket_unit: TrendBucket,
) -> Result<UsageOverview, String> {
    let mut all = collect_rounds(conn, filter)?;
    let summary = summarize_rounds(&all);
    let trends = bucket_rounds(&all, bucket_unit);
    sort_rounds(&mut all, sort);
    let rounds = all.into_iter().skip(offset).take(limit).collect();
    Ok(UsageOverview {
        summary,
        trends,
        rounds,
    })
}
