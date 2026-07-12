use std::collections::BTreeMap;

use chrono::{Duration, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use database::db::get_connection;

use core_types::key_source::KeySource;

use super::aggregation::{cached_external_history_sessions_in_range, list_all_sessions};
use super::pricing_catalog::{self, ModelPricing};
use super::types::{SessionAggregateRecord, SessionFilter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageSourceLabel {
    Local,
    Pooling,
}

impl UsageSourceLabel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Pooling => "pooling",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeatmapMetric {
    Sessions,
    Tokens,
    Cost,
}

impl HeatmapMetric {
    fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.unwrap_or("sessions") {
            "sessions" => Ok(Self::Sessions),
            "tokens" => Ok(Self::Tokens),
            "cost" => Ok(Self::Cost),
            other => Err(format!("Unknown heatmap metric: {other}")),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageSummary {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
    pub context_tokens: i64,
    /// Headline cost figure: recorded metered spend when known, otherwise the
    /// list-price estimate. Preserves the historical single-`cost` semantics.
    pub cost_usd: f64,
    /// Real metered spend for this session. Non-zero only for metered routes
    /// (pooled / hosted-key). `$0` for subscription / own-key routes.
    pub recorded_cost_usd: f64,
    /// List-price estimate: tokens × catalog rate. Always populated when the
    /// session has tokens, regardless of billing route.
    pub estimated_cost_usd: f64,
}

impl SessionUsageSummary {
    pub fn billable_tokens(&self) -> i64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHeatmapSession {
    pub session_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_input: Option<String>,
    #[serde(rename = "cliAgentType", skip_serializing_if = "Option::is_none")]
    pub cli_agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_icon_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHeatmapCell {
    pub day: u8,
    pub date: String,
    pub label: String,
    pub hour: u8,
    pub count: i64,
    pub tokens: i64,
    pub cost: f64,
    pub sessions: Vec<SessionHeatmapSession>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHeatmapResponse {
    pub cells: Vec<SessionHeatmapCell>,
    pub max_count: i64,
    pub max_tokens: i64,
    pub max_cost: f64,
    pub total_sessions: i64,
    pub total_tokens: i64,
    pub total_cost: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHeatmapFilter {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub metric: Option<String>,
    pub category: Option<String>,
    pub key_source: Option<String>,
    pub timezone_offset_minutes: Option<i32>,
}

/// Whether a route's spend is metered by us (pooled / hosted-key) — i.e. we can
/// report a *recorded* dollar figure — versus a subscription / own-key route
/// where only a list-price *estimate* is available.
fn route_is_metered(key_source: KeySource) -> bool {
    key_source == KeySource::HostedKey
}

pub fn usage_source_for(record: &SessionAggregateRecord) -> UsageSourceLabel {
    if record.key_source == KeySource::HostedKey {
        UsageSourceLabel::Pooling
    } else {
        UsageSourceLabel::Local
    }
}

pub fn session_usage_summary(session_id: &str) -> Result<SessionUsageSummary, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {err}"))?;
    session_usage_summary_with_conn(&conn, session_id)
}

pub fn session_usage_summary_with_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<SessionUsageSummary, String> {
    session_usage_summary_with_fallback(conn, session_id, 0)
}

pub fn session_usage_summary_with_fallback(
    conn: &Connection,
    session_id: &str,
    fallback_total_tokens: i64,
) -> Result<SessionUsageSummary, String> {
    // Public entry point without route context: no recorded metered spend is
    // known, so the summary carries the list-price estimate only.
    session_usage_summary_priced(conn, session_id, fallback_total_tokens, false)
}

/// Build a usage summary, pricing tokens through the bundled catalog and
/// deciding recorded vs estimated cost from `metered`.
///
/// Tokens are sourced from the native `session_token_usage` table; when a
/// session has none there (imported / external history), its tokens are read
/// from `imported_history_session_cache` so it is no longer priced at `$0`
/// purely because its tokens live in a different table.
pub fn session_usage_summary_priced(
    conn: &Connection,
    session_id: &str,
    fallback_total_tokens: i64,
    metered: bool,
) -> Result<SessionUsageSummary, String> {
    let mut stmt = conn
        .prepare(
            "SELECT
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cache_read_tokens), 0),
                COALESCE(SUM(cache_write_tokens), 0),
                COALESCE(SUM(total_tokens), 0),
                COALESCE(MAX(context_tokens), 0)
             FROM session_token_usage
             WHERE session_id = ?1",
        )
        .map_err(|err| format!("SQL prepare error: {err}"))?;

    let mut summary = stmt
        .query_row([session_id], |row| {
            Ok(SessionUsageSummary {
                input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                cache_read_tokens: row.get(2)?,
                cache_write_tokens: row.get(3)?,
                total_tokens: row.get(4)?,
                context_tokens: row.get(5)?,
                cost_usd: 0.0,
                recorded_cost_usd: 0.0,
                estimated_cost_usd: 0.0,
            })
        })
        .map_err(|err| format!("Row read error: {err}"))?;

    let mut model = session_model(conn, session_id)?;

    // Imported / external-history sessions keep their tokens in a separate cache
    // table. If the native table had nothing, price those tokens too.
    if summary.billable_tokens() == 0 {
        if let Some(imported) = imported_history_tokens(conn, session_id)? {
            summary.input_tokens = imported.input_tokens;
            summary.output_tokens = imported.output_tokens;
            if model.as_deref().unwrap_or("").is_empty() && !imported.model.is_empty() {
                model = Some(imported.model);
            }
        }
    }

    if summary.total_tokens == 0 {
        let billable_tokens = summary.billable_tokens();
        summary.total_tokens = if billable_tokens > 0 {
            billable_tokens
        } else {
            fallback_total_tokens.max(0)
        };
    }

    let pricing = pricing_catalog::resolve_pricing(model.as_deref());
    let estimated = calculate_cost_usd(&summary, pricing);
    let recorded = if metered { estimated } else { 0.0 };
    summary.estimated_cost_usd = estimated;
    summary.recorded_cost_usd = recorded;
    // Headline cost preserves the historical single-figure semantics:
    // recorded metered spend when known, otherwise the list-price estimate.
    summary.cost_usd = if recorded > 0.0 { recorded } else { estimated };
    Ok(summary)
}

/// Tokens/model pulled from `imported_history_session_cache` for one session.
struct ImportedHistoryTokens {
    input_tokens: i64,
    output_tokens: i64,
    model: String,
}

fn imported_history_tokens(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ImportedHistoryTokens>, String> {
    let table_exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master
             WHERE type = 'table' AND name = 'imported_history_session_cache' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(|err| format!("SQL query error: {err}"))?
        .is_some();
    if !table_exists {
        return Ok(None);
    }

    conn.query_row(
        "SELECT
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(MAX(model), '')
         FROM imported_history_session_cache
         WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(ImportedHistoryTokens {
                input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                model: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("SQL query error: {err}"))
    .map(|tokens| tokens.filter(|t| t.input_tokens > 0 || t.output_tokens > 0))
}

pub fn session_usage_summaries(
    sessions: &[SessionAggregateRecord],
) -> Result<BTreeMap<String, SessionUsageSummary>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {err}"))?;
    let mut summaries = BTreeMap::new();
    for session in sessions {
        summaries.insert(
            session.session_id.clone(),
            session_usage_summary_priced(
                &conn,
                &session.session_id,
                session.total_tokens,
                route_is_metered(session.key_source),
            )?,
        );
    }
    Ok(summaries)
}

pub fn query_session_heatmap(
    filter: Option<&SessionHeatmapFilter>,
) -> Result<SessionHeatmapResponse, String> {
    let metric = HeatmapMetric::parse(filter.and_then(|filter| filter.metric.as_deref()))?;
    let timezone_offset_minutes = filter
        .and_then(|filter| filter.timezone_offset_minutes)
        .unwrap_or(0);
    let date_window = heatmap_date_window(
        filter.and_then(|filter| filter.start_date.as_deref()),
        filter.and_then(|filter| filter.end_date.as_deref()),
    )?;
    let (window_start_ms, window_end_ms) =
        external_history_epoch_window(&date_window, timezone_offset_minutes)?;
    let session_filter = SessionFilter {
        category: filter.and_then(|filter| filter.category.clone()),
        key_source: filter.and_then(|filter| filter.key_source.clone()),
        include_external_history: Some(false),
        include_stats: Some(false),
        created_after_ms: Some(window_start_ms),
        created_before_ms: Some(window_end_ms),
        skip_orgtrack_upsert: true,
        ..SessionFilter::default()
    };
    let mut sessions = list_all_sessions(Some(&session_filter))?.sessions;
    if should_include_cli_history(filter) {
        let (external_start_ms, external_end_ms) = (window_start_ms, window_end_ms);
        let external_sessions =
            cached_external_history_sessions_in_range(external_start_ms, external_end_ms)?;
        sessions.extend(external_sessions);
    }
    retain_sessions_in_date_window(&mut sessions, &date_window, timezone_offset_minutes);
    let usage_by_session = session_usage_summaries(&sessions)?;
    let date_index: BTreeMap<NaiveDate, u8> = date_window
        .iter()
        .enumerate()
        .map(|(index, date)| (*date, index as u8))
        .collect();
    let mut buckets: BTreeMap<(u8, u8), SessionHeatmapCell> = BTreeMap::new();

    for session in sessions {
        let Some((session_date, hour)) =
            date_hour_from_timestamp(&session.created_at, timezone_offset_minutes)
        else {
            continue;
        };
        let Some(day) = date_index.get(&session_date).copied() else {
            continue;
        };
        let usage = usage_by_session
            .get(&session.session_id)
            .cloned()
            .unwrap_or_default();
        let cell = buckets
            .entry((day, hour))
            .or_insert_with(|| heatmap_empty_cell(day, session_date, hour));
        cell.count += 1;
        cell.tokens += if usage.total_tokens > 0 {
            usage.total_tokens
        } else {
            session.total_tokens
        };
        cell.cost += usage.cost_usd;
        cell.sessions.push(SessionHeatmapSession {
            session_id: session.session_id,
            name: session.name,
            user_input: session.user_input,
            cli_agent_type: session.cli_agent_type,
            agent_icon_id: session.agent_icon_id,
        });
    }

    let mut cells = Vec::with_capacity(date_window.len() * 24);
    let mut max_count = 0;
    let mut max_tokens = 0;
    let mut max_cost = 0.0;
    let mut total_sessions = 0;
    let mut total_tokens = 0;
    let mut total_cost = 0.0;

    for (day, date) in date_window.into_iter().enumerate() {
        let day = day as u8;
        for hour in 0..24 {
            let cell = buckets
                .remove(&(day, hour))
                .unwrap_or_else(|| heatmap_empty_cell(day, date, hour));
            max_count = max_count.max(cell.count);
            max_tokens = max_tokens.max(cell.tokens);
            max_cost = f64::max(max_cost, cell.cost);
            total_sessions += cell.count;
            total_tokens += cell.tokens;
            total_cost += cell.cost;
            cells.push(cell);
        }
    }

    if metric == HeatmapMetric::Cost && max_cost == 0.0 {
        max_cost = 1.0;
    }

    Ok(SessionHeatmapResponse {
        cells,
        max_count,
        max_tokens,
        max_cost,
        total_sessions,
        total_tokens,
        total_cost,
    })
}

fn retain_sessions_in_date_window(
    sessions: &mut Vec<SessionAggregateRecord>,
    date_window: &[NaiveDate],
    timezone_offset_minutes: i32,
) {
    let date_index: BTreeMap<NaiveDate, u8> = date_window
        .iter()
        .enumerate()
        .map(|(index, date)| (*date, index as u8))
        .collect();
    sessions.retain(|session| {
        date_hour_from_timestamp(&session.created_at, timezone_offset_minutes)
            .map(|(session_date, _hour)| date_index.contains_key(&session_date))
            .unwrap_or(false)
    });
}

fn should_include_cli_history(filter: Option<&SessionHeatmapFilter>) -> bool {
    let includes_cli_category = filter
        .and_then(|filter| filter.category.as_deref())
        .map(|raw| raw.split(',').map(str::trim).any(|value| value == "cli"))
        .unwrap_or(true);
    let includes_own_key = filter
        .and_then(|filter| filter.key_source.as_deref())
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .any(|value| value == KeySource::OwnKey.as_ref())
        })
        .unwrap_or(true);
    includes_cli_category && includes_own_key
}

fn external_history_epoch_window(
    date_window: &[NaiveDate],
    timezone_offset_minutes: i32,
) -> Result<(i64, i64), String> {
    let Some(start_date) = date_window.first() else {
        return Err("Heatmap date window is empty".to_string());
    };
    let Some(end_date) = date_window.last() else {
        return Err("Heatmap date window is empty".to_string());
    };
    let offset = Duration::minutes(i64::from(timezone_offset_minutes));
    let start = Utc
        .from_utc_datetime(&start_date.and_time(NaiveTime::MIN))
        .checked_add_signed(offset)
        .ok_or_else(|| "Heatmap start date is outside supported timestamp range".to_string())?
        .timestamp_millis();
    let end = Utc
        .from_utc_datetime(
            &end_date.and_hms_milli_opt(23, 59, 59, 999).ok_or_else(|| {
                "Heatmap end date is outside supported timestamp range".to_string()
            })?,
        )
        .checked_add_signed(offset)
        .ok_or_else(|| "Heatmap end date is outside supported timestamp range".to_string())?
        .timestamp_millis();
    Ok((start, end))
}

fn calculate_cost_usd(summary: &SessionUsageSummary, pricing: ModelPricing) -> f64 {
    cost_for(summary.input_tokens, pricing.input_per_mtok)
        + cost_for(summary.output_tokens, pricing.output_per_mtok)
        + cost_for(summary.cache_write_tokens, pricing.cache_creation_per_mtok)
        + cost_for(summary.cache_read_tokens, pricing.cache_read_per_mtok)
}

fn cost_for(tokens: i64, per_mtok: f64) -> f64 {
    (tokens.max(0) as f64 / 1_000_000.0) * per_mtok
}

fn session_model(conn: &Connection, session_id: &str) -> Result<Option<String>, String> {
    let model = conn
        .query_row(
            "SELECT model FROM session_token_usage
             WHERE session_id = ?1 AND model IS NOT NULL AND model != ''
             ORDER BY created_at DESC
             LIMIT 1",
            [session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("SQL query error: {err}"))?;
    if model.is_some() {
        return Ok(model);
    }

    conn.query_row(
        "SELECT model FROM code_sessions WHERE session_id = ?1
         UNION ALL
         SELECT model FROM agent_sessions WHERE session_id = ?1
         LIMIT 1",
        [session_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|value| value.flatten())
    .map_err(|err| format!("SQL query error: {err}"))
}

fn heatmap_date_window(
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<NaiveDate>, String> {
    let end_date = match end_date {
        Some(raw) => parse_heatmap_date(raw)?,
        None => chrono::Utc::now().date_naive(),
    };
    let start_date = match start_date {
        Some(raw) => parse_heatmap_date(raw)?,
        None => end_date - Duration::days(7),
    };
    if start_date > end_date {
        return Err("Heatmap startDate must be before or equal to endDate".to_string());
    }

    let day_count = (end_date - start_date).num_days() + 1;
    Ok((0..day_count)
        .map(|offset| start_date + Duration::days(offset))
        .collect())
}

fn parse_heatmap_date(raw: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|err| format!("Invalid heatmap date '{raw}': {err}"))
}

fn heatmap_empty_cell(day: u8, date: NaiveDate, hour: u8) -> SessionHeatmapCell {
    SessionHeatmapCell {
        day,
        date: date.format("%Y-%m-%d").to_string(),
        label: date.format("%a").to_string(),
        hour,
        count: 0,
        tokens: 0,
        cost: 0.0,
        sessions: Vec::new(),
    }
}

fn date_hour_from_timestamp(
    timestamp: &str,
    timezone_offset_minutes: i32,
) -> Option<(NaiveDate, u8)> {
    let parsed = chrono::DateTime::parse_from_rfc3339(timestamp).ok()?;
    let local =
        parsed.with_timezone(&chrono::Utc) - Duration::minutes(i64::from(timezone_offset_minutes));
    Some((local.date_naive(), local.hour() as u8))
}
