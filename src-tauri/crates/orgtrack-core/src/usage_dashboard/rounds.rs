use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension};

use crate::pricing;

use super::model::*;

/// Fold a per-round set into the headline [`UsageSummary`].
pub(super) fn summarize_rounds(rounds: &[UsageRoundRow]) -> UsageSummary {
    let mut summary = UsageSummary::default();
    let mut per_bucket: BTreeMap<String, BucketSummary> = BTreeMap::new();
    let mut sessions_seen: HashSet<String> = HashSet::new();
    let mut bucket_sessions: HashMap<String, HashSet<String>> = HashMap::new();

    for round in rounds {
        summary.request_count += 1;
        if sessions_seen.insert(round.session_id.clone()) {
            summary.session_count += 1;
        }
        summary.input_tokens += round.input_tokens;
        summary.output_tokens += round.output_tokens;
        summary.cache_read_tokens += round.cache_read_tokens;
        summary.cache_write_tokens += round.cache_write_tokens;
        summary.cost_usd += round.cost_usd;

        let entry = per_bucket
            .entry(round.bucket.clone())
            .or_insert_with(|| BucketSummary {
                bucket: round.bucket.clone(),
                ..BucketSummary::default()
            });
        entry.real_total_tokens += round.real_total_tokens;
        entry.cost_usd += round.cost_usd;
        if bucket_sessions
            .entry(round.bucket.clone())
            .or_default()
            .insert(round.session_id.clone())
        {
            entry.session_count += 1;
        }
    }

    summary.real_total_tokens = summary
        .input_tokens
        .saturating_add(summary.output_tokens)
        .saturating_add(summary.cache_read_tokens)
        .saturating_add(summary.cache_write_tokens);
    summary.total_tokens = summary.real_total_tokens;
    // Rounds carry list-price estimates; recorded metered spend isn't tracked
    // per round, so the headline == estimated here.
    summary.estimated_cost_usd = summary.cost_usd;
    summary.cache_hit_rate = cache_hit_rate(
        summary.input_tokens,
        summary.cache_write_tokens,
        summary.cache_read_tokens,
    );
    summary.by_bucket = per_bucket.into_values().collect();
    summary
}

/// A native per-turn token row, pulled once and filtered in Rust.
struct NativeTurn {
    session_id: String,
    created_at: String,
    model: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
}

fn fetch_native_turns(conn: &Connection) -> Result<Vec<NativeTurn>, String> {
    let mut statement = conn
        .prepare(
            "SELECT session_id, created_at, model,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
             FROM session_token_usage",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(NativeTurn {
                session_id: row.get(0)?,
                created_at: row.get(1)?,
                model: row.get(2)?,
                input_tokens: row.get(3)?,
                output_tokens: row.get(4)?,
                cache_read_tokens: row.get(5)?,
                cache_write_tokens: row.get(6)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())
}

/// List-price cost for a token split at a model's rates.
fn turn_cost(
    model: Option<&str>,
    input: i64,
    output: i64,
    cache_write: i64,
    cache_read: i64,
) -> f64 {
    let pricing = pricing::resolve_pricing(model);
    let per = |tokens: i64, rate: f64| (tokens.max(0) as f64 / 1_000_000.0) * rate;
    per(input, pricing.input_per_mtok)
        + per(output, pricing.output_per_mtok)
        + per(cache_write, pricing.cache_creation_per_mtok)
        + per(cache_read, pricing.cache_read_per_mtok)
}

/// One per-round row read from `imported_history_round_usage`.
struct ImportedRound {
    session_id: String,
    model: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    created_at_ms: i64,
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
        [name],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

fn fetch_imported_rounds(
    conn: &Connection,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<Vec<ImportedRound>, String> {
    if !table_exists(conn, "imported_history_round_usage") {
        return Ok(Vec::new());
    }
    // Bound the scan to the time window (created_at_ms is indexed) so a large
    // all-time round table isn't loaded on every refresh.
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<i64> = Vec::new();
    if let Some(start) = start_ms {
        clauses.push(format!("created_at_ms >= ?{}", params.len() + 1));
        params.push(start);
    }
    if let Some(end) = end_ms {
        clauses.push(format!("created_at_ms <= ?{}", params.len() + 1));
        params.push(end);
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    let sql = format!(
        "SELECT session_id, model, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, created_at_ms
         FROM imported_history_round_usage{where_sql}"
    );
    let mut statement = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(params), |row| {
            Ok(ImportedRound {
                session_id: row.get(0)?,
                model: row
                    .get::<_, String>(1)
                    .map(|model| Some(model).filter(|value| !value.is_empty()))?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
                cache_read_tokens: row.get(4)?,
                cache_write_tokens: row.get(5)?,
                created_at_ms: row.get(6)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())
}

#[allow(clippy::too_many_arguments)]
fn build_round_row(
    session: &ScopedSession,
    index: usize,
    model: Option<String>,
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    created_at_ms: i64,
) -> UsageRoundRow {
    let model = model.or_else(|| session.model.clone());
    let cost = turn_cost(model.as_deref(), input, output, cache_write, cache_read);
    UsageRoundRow {
        round_id: format!("{}#{index}", session.session_id),
        session_id: session.session_id.clone(),
        session_name: session.name.clone(),
        bucket: session.bucket.clone(),
        source: session.source.clone(),
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_write_tokens: cache_write,
        real_total_tokens: input
            .saturating_add(output)
            .saturating_add(cache_read)
            .saturating_add(cache_write),
        cost_usd: cost,
        created_at_ms,
    }
}

/// The unified per-round request log for the filter's scope: real per-round
/// rows where a source emits them (codex/claude in `imported_history_round_usage`,
/// native org2 turns in `session_token_usage`), and one synthesized fallback
/// round from the session totals for imported sources that have none
/// (cursor/opencode/…). Rounds outside the time window are dropped.
pub(super) fn collect_rounds(
    conn: &Connection,
    filter: &UsageFilter,
) -> Result<Vec<UsageRoundRow>, String> {
    let mut sessions = fetch_scoped_sessions(conn, filter.bucket.as_deref(), filter.all_sources)?;
    if let Some(session_id) = filter.session_id.as_deref() {
        sessions.retain(|session| session.session_id == session_id);
    }

    let mut imported_by: HashMap<String, Vec<ImportedRound>> = HashMap::new();
    for round in fetch_imported_rounds(conn, filter.start_ms, filter.end_ms)? {
        imported_by
            .entry(round.session_id.clone())
            .or_default()
            .push(round);
    }
    let mut native_by: HashMap<String, Vec<NativeTurn>> = HashMap::new();
    for turn in fetch_native_turns(conn)? {
        native_by
            .entry(turn.session_id.clone())
            .or_default()
            .push(turn);
    }

    let mut rows = Vec::new();
    for session in &sessions {
        if let Some(mut imported) = imported_by.remove(&session.session_id) {
            imported.sort_by_key(|round| round.created_at_ms);
            for (index, round) in imported.into_iter().enumerate() {
                if !filter.contains(round.created_at_ms) {
                    continue;
                }
                rows.push(build_round_row(
                    session,
                    index,
                    round.model,
                    round.input_tokens,
                    round.output_tokens,
                    round.cache_read_tokens,
                    round.cache_write_tokens,
                    round.created_at_ms,
                ));
            }
        } else if session.tokens_source == crate::session_usage::TOKENS_SOURCE_NATIVE {
            let mut turns: Vec<(i64, NativeTurn)> = native_by
                .remove(&session.session_id)
                .unwrap_or_default()
                .into_iter()
                .map(|turn| (iso_to_ms(&turn.created_at).unwrap_or(0), turn))
                .collect();
            turns.sort_by_key(|(ms, _)| *ms);
            for (index, (ms, turn)) in turns.into_iter().enumerate() {
                if !filter.contains(ms) {
                    continue;
                }
                rows.push(build_round_row(
                    session,
                    index,
                    turn.model,
                    turn.input_tokens,
                    turn.output_tokens,
                    turn.cache_read_tokens,
                    turn.cache_write_tokens,
                    ms,
                ));
            }
        } else if session.last_active_ms > 0
            && filter.contains(session.last_active_ms)
            && session.real_total_tokens() > 0
        {
            // Fallback: one synthesized round from the session totals (the
            // projection's input is already fresh).
            rows.push(build_round_row(
                session,
                0,
                session.model.clone(),
                session.input_tokens,
                session.output_tokens,
                session.cache_read_tokens,
                session.cache_write_tokens,
                session.last_active_ms,
            ));
        }
    }
    Ok(rows)
}

/// Sort a per-round set in place by the chosen key (descending).
pub(super) fn sort_rounds(rows: &mut [UsageRoundRow], sort: SessionSort) {
    match sort {
        SessionSort::Cost => rows.sort_by(|a, b| {
            b.cost_usd
                .partial_cmp(&a.cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        SessionSort::Tokens => rows.sort_by_key(|row| std::cmp::Reverse(row.real_total_tokens)),
        SessionSort::Recent => rows.sort_by_key(|row| std::cmp::Reverse(row.created_at_ms)),
    }
}

/// Bucket a per-round set into a time series.
pub(super) fn bucket_rounds(rounds: &[UsageRoundRow], bucket_unit: TrendBucket) -> Vec<UsageTrendPoint> {
    let mut points: HashMap<i64, UsageTrendPoint> = HashMap::new();
    for round in rounds {
        if round.created_at_ms <= 0 {
            continue;
        }
        let key = bucket_unit.floor(round.created_at_ms);
        let point = points.entry(key).or_insert_with(|| UsageTrendPoint {
            bucket_ms: key,
            ..UsageTrendPoint::default()
        });
        point.input_tokens += round.input_tokens;
        point.output_tokens += round.output_tokens;
        point.cache_write_tokens += round.cache_write_tokens;
        point.cache_read_tokens += round.cache_read_tokens;
        point.cost_usd += round.cost_usd;
    }
    let mut series: Vec<UsageTrendPoint> = points.into_values().collect();
    series.sort_by_key(|point| point.bucket_ms);
    series
}
