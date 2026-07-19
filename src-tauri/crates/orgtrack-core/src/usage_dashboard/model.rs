use rusqlite::Connection;
use serde::Serialize;

/// Source buckets surfaced as dashboard filters.
pub const BUCKET_CLAUDE: &str = "claude";
pub const BUCKET_CODEX: &str = "codex";
pub const BUCKET_CURSOR: &str = "cursor";
pub const BUCKET_ORG2: &str = "org2";
/// Anything outside the four scoped buckets (opencode, windsurf, …). Hidden
/// from the default "all" view; only reachable by an explicit bucket filter.
pub const BUCKET_OTHER: &str = "other";

/// The buckets the dashboard shows when no explicit filter is set.
pub const SCOPED_BUCKETS: [&str; 4] = [BUCKET_CLAUDE, BUCKET_CODEX, BUCKET_CURSOR, BUCKET_ORG2];

/// Milliseconds in one hour / day, for trend bucketing.
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 86_400_000;

/// Dashboard scope: an optional source bucket plus an optional `[start, end]`
/// activity window (epoch milliseconds, inclusive).
#[derive(Debug, Clone, Default)]
pub struct UsageFilter {
    /// `None` = the four [`SCOPED_BUCKETS`]; `Some(bucket)` = only that bucket.
    pub bucket: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    /// Restrict to a single session (for the request-log session filter).
    pub session_id: Option<String>,
    /// When `true` and no `bucket` is set, include every source — the long-tail
    /// providers and plugin sources that map to the `other` bucket — instead of
    /// only the four [`SCOPED_BUCKETS`]. The desktop dashboard leaves this
    /// `false` (its default); the CLI opts in so `usage` covers all tools.
    pub all_sources: bool,
}

impl UsageFilter {
    /// Whether an activity timestamp (epoch ms) falls inside the window.
    pub(super) fn contains(&self, ts_ms: i64) -> bool {
        if let Some(start) = self.start_ms {
            if ts_ms < start {
                return false;
            }
        }
        if let Some(end) = self.end_ms {
            if ts_ms > end {
                return false;
            }
        }
        true
    }
}

/// Time granularity of a [`UsageTrendPoint`] series.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrendBucket {
    Hour,
    Day,
}

impl TrendBucket {
    fn size_ms(self) -> i64 {
        match self {
            TrendBucket::Hour => HOUR_MS,
            TrendBucket::Day => DAY_MS,
        }
    }

    pub(super) fn floor(self, ts_ms: i64) -> i64 {
        let size = self.size_ms();
        (ts_ms / size) * size
    }
}

/// Headline totals across every in-scope session, plus a per-bucket breakdown.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub session_count: i64,
    /// Native turns + one per imported session — the "requests" headline.
    pub request_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    /// input + output + cache_read + cache_write.
    pub real_total_tokens: i64,
    /// Projection `total_tokens` sum (writer-reported total; may differ from
    /// `real_total_tokens` for total-only sources).
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub estimated_cost_usd: f64,
    pub recorded_cost_usd: f64,
    /// cache_read / (input + cache_write + cache_read), range 0–1.
    pub cache_hit_rate: f64,
    pub by_bucket: Vec<BucketSummary>,
}

/// Per-bucket slice of a [`UsageSummary`] (for legend / breakdown chips).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketSummary {
    pub bucket: String,
    pub session_count: i64,
    pub real_total_tokens: i64,
    pub cost_usd: f64,
}

/// One row of the per-session table.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSessionRow {
    pub session_id: String,
    pub name: String,
    pub bucket: String,
    pub source: String,
    pub model: Option<String>,
    pub tokens_source: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
    pub real_total_tokens: i64,
    pub cost_usd: f64,
    pub estimated_cost_usd: f64,
    pub recorded_cost_usd: f64,
    pub cache_hit_rate: f64,
    /// Native per-turn count; 0 for imported sessions (no per-turn store).
    pub turn_count: i64,
    /// Last activity, epoch ms (0 = unknown).
    pub last_active_ms: i64,
}

/// One point of the trend series (tokens + cost in one time bucket).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTrendPoint {
    /// Start of the bucket, epoch ms.
    pub bucket_ms: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost_usd: f64,
}

/// Sort key for the per-session table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionSort {
    Cost,
    Tokens,
    Recent,
}

impl SessionSort {
    /// Parse a wire string; unknown values fall back to `Recent`.
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("recent") {
            "cost" => SessionSort::Cost,
            "tokens" => SessionSort::Tokens,
            _ => SessionSort::Recent,
        }
    }
}

// ============================================================================
// Internal: the deduped, bucket-scoped session set (the shared read model)
// ============================================================================

/// One projected session already filtered to the bucket scope and with mirror
/// rows removed. Time filtering is applied by callers (summary/table filter by
/// `last_active_ms`; trends filter their turns by `created_at`).
#[derive(Debug, Clone)]
pub(super) struct ScopedSession {
    pub(super) session_id: String,
    pub(super) name: String,
    pub(super) bucket: String,
    pub(super) source: String,
    pub(super) model: Option<String>,
    pub(super) tokens_source: String,
    pub(super) input_tokens: i64,
    pub(super) output_tokens: i64,
    pub(super) cache_read_tokens: i64,
    pub(super) cache_write_tokens: i64,
    pub(super) total_tokens: i64,
    pub(super) cost_usd: f64,
    pub(super) estimated_cost_usd: f64,
    pub(super) recorded_cost_usd: f64,
    pub(super) turn_count: i64,
    pub(super) last_active_ms: i64,
}

impl ScopedSession {
    pub(super) fn real_total_tokens(&self) -> i64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
    }
}

/// SQL `CASE` expression that maps a projection row (alias `u`) + optional
/// `code_sessions` row (alias `cs`) to a source bucket string. Kept in one
/// place so every query buckets identically.
fn bucket_case_sql() -> &'static str {
    "CASE
        WHEN u.source = 'orgii_rust_agents' THEN 'org2'
        WHEN u.source = 'claude_code' THEN 'claude'
        WHEN u.source = 'codex_app' THEN 'codex'
        WHEN u.source IN ('cursor_ide', 'cursor_cli') THEN 'cursor'
        WHEN u.source = 'orgii_cli_sessions' THEN
            CASE
                WHEN lower(coalesce(cs.cli_agent_type, '')) LIKE 'claude%' THEN 'claude'
                WHEN lower(coalesce(cs.cli_agent_type, '')) LIKE 'codex%' THEN 'codex'
                WHEN lower(coalesce(cs.cli_agent_type, '')) LIKE 'cursor%' THEN 'cursor'
                ELSE 'org2'
            END
        ELSE 'other'
    END"
}

/// Parse an ISO-8601 / RFC-3339 timestamp to epoch milliseconds. Handles the
/// `Z`, offset, and space-separated variants written across stores; returns
/// `None` for empty or unparseable values.
pub(super) fn iso_to_ms(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.timestamp_millis());
    }
    // Fallbacks for non-offset timestamps (assume UTC).
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
    ] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Some(naive.and_utc().timestamp_millis());
        }
    }
    None
}

/// Fetch the deduped, bucket-scoped session set. Applies the bucket filter and
/// mirror exclusion in SQL; does **not** apply the time window (callers do).
pub(super) fn fetch_scoped_sessions(
    conn: &Connection,
    bucket: Option<&str>,
    all_sources: bool,
) -> Result<Vec<ScopedSession>, String> {
    // The bucket predicate is the only structural difference, so build it once.
    let bucket_predicate = if bucket.is_some() {
        "outer_bucket = ?1".to_string()
    } else if all_sources {
        // Every source, including the `other` bucket (long-tail + plugins).
        "1 = 1".to_string()
    } else {
        // Default "all" = the four scoped buckets (never `other`).
        let list = SCOPED_BUCKETS
            .iter()
            .map(|b| format!("'{b}'"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("outer_bucket IN ({list})")
    };

    let sql = format!(
        "WITH scoped AS (
            SELECT
                u.session_id AS session_id,
                u.source AS source,
                u.model AS model,
                u.tokens_source AS tokens_source,
                u.input_tokens AS input_tokens,
                u.output_tokens AS output_tokens,
                u.cache_read_tokens AS cache_read_tokens,
                u.cache_write_tokens AS cache_write_tokens,
                u.total_tokens AS total_tokens,
                u.cost_usd AS cost_usd,
                u.estimated_cost_usd AS estimated_cost_usd,
                u.recorded_cost_usd AS recorded_cost_usd,
                {bucket_case} AS outer_bucket,
                coalesce(
                    nullif(cs.name, ''),
                    nullif(ags.name, ''),
                    (SELECT ihc.name FROM imported_history_session_cache ihc
                     WHERE ihc.session_id = u.session_id AND ihc.listable = 1
                     ORDER BY ihc.updated_at_ms DESC LIMIT 1),
                    u.session_id
                ) AS name,
                coalesce(cs.updated_at, ags.updated_at, '') AS owner_updated_at,
                (SELECT max(ihc.updated_at_ms) FROM imported_history_session_cache ihc
                 WHERE ihc.session_id = u.session_id AND ihc.listable = 1) AS imported_updated_ms,
                (SELECT count(*) FROM session_token_usage stu
                 WHERE stu.session_id = u.session_id) AS turn_count
            FROM orgtrack_core_session_usage u
            LEFT JOIN code_sessions cs ON cs.session_id = u.session_id
            LEFT JOIN agent_sessions ags ON ags.session_id = u.session_id
            WHERE u.session_id NOT IN (
                SELECT session_id FROM imported_history_session_cache WHERE listable = 0
            )
        )
        SELECT session_id, source, model, tokens_source,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
               cost_usd, estimated_cost_usd, recorded_cost_usd,
               outer_bucket, name, owner_updated_at, imported_updated_ms, turn_count
        FROM scoped
        WHERE {bucket_predicate}",
        bucket_case = bucket_case_sql(),
    );

    let mut statement = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<ScopedSession> {
        let owner_updated_at: String = row.get(14)?;
        let imported_updated_ms: Option<i64> = row.get(15)?;
        let last_active_ms = iso_to_ms(&owner_updated_at)
            .or(imported_updated_ms)
            .unwrap_or(0);
        Ok(ScopedSession {
            session_id: row.get(0)?,
            source: row.get(1)?,
            model: row.get(2)?,
            tokens_source: row.get(3)?,
            input_tokens: row.get(4)?,
            output_tokens: row.get(5)?,
            cache_read_tokens: row.get(6)?,
            cache_write_tokens: row.get(7)?,
            total_tokens: row.get(8)?,
            cost_usd: row.get(9)?,
            estimated_cost_usd: row.get(10)?,
            recorded_cost_usd: row.get(11)?,
            bucket: row.get(12)?,
            name: row.get(13)?,
            turn_count: row.get(16)?,
            last_active_ms,
        })
    };

    let rows = if let Some(bucket) = bucket {
        statement.query_map([bucket], map_row)
    } else {
        statement.query_map([], map_row)
    }
    .map_err(|err| err.to_string())?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())
}

/// Cache-hit rate: cache_read / (input + cache_write + cache_read). `0.0` when
/// there is no cacheable input.
pub(super) fn cache_hit_rate(input: i64, cache_write: i64, cache_read: i64) -> f64 {
    let denom = input.saturating_add(cache_write).saturating_add(cache_read);
    if denom <= 0 {
        return 0.0;
    }
    cache_read as f64 / denom as f64
}

/// One request-log row: a single assistant round / LLM call. `input_tokens` is
/// FRESH (cache excluded); `real_total_tokens` re-adds cache.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRoundRow {
    /// `session_id#index` — stable within a fetch.
    pub round_id: String,
    pub session_id: String,
    pub session_name: String,
    pub bucket: String,
    pub source: String,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub real_total_tokens: i64,
    pub cost_usd: f64,
    pub created_at_ms: i64,
}
