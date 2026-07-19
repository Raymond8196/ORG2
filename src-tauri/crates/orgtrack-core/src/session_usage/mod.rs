//! Per-session usage/cost projection (`orgtrack_core_session_usage`).
//!
//! One row per session, recomputed after every token write and repaired by a
//! bounded startup backfill. Invariants the math depends on:
//!
//! - Tokens are read from `session_token_usage` (per-turn rollups) only.
//!   `session_llm_usage_spans` / `session_tool_usage` describe the *same*
//!   tokens at per-LLM-call granularity — summing both stores would
//!   double-count, so spans are never read here.
//! - `context_tokens` is a context-window fill level, not a rate: aggregated
//!   with MAX across turns, never SUM.
//! - Imported / external-history tokens (`imported_history_session_cache`)
//!   are used only when the session has zero native billable tokens, so a
//!   session present in both stores is never double-counted.
//! - `recorded_cost_usd` is non-zero only for metered routes (hosted key);
//!   subscription / own-key routes carry a list-price estimate only.
//! - Owning-row lookups (`code_sessions` / `agent_sessions` / imported cache /
//!   `orgtrack_core_sessions`) are best-effort: those tables belong to other
//!   layers and may not exist in every database this crate opens.

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::canonical::{SOURCE_ORGII_CLI_SESSIONS, SOURCE_ORGII_RUST_AGENTS};
use crate::pricing::{self, ModelPricing};
use crate::store::{sqlite::SqliteRecordStore, RecordStore};

/// `tokens_source` value: tokens came from native `session_token_usage` rows.
pub const TOKENS_SOURCE_NATIVE: &str = "native";
/// `tokens_source` value: tokens came from `imported_history_session_cache`.
pub const TOKENS_SOURCE_IMPORTED: &str = "imported";
/// `tokens_source` value: no token data found in either store.
pub const TOKENS_SOURCE_NONE: &str = "none";

/// One projected `orgtrack_core_session_usage` row.
///
/// Carries the recorded/estimated/headline cost triple: `recorded_cost_usd`
/// is real metered spend (metered routes only), `estimated_cost_usd` is the
/// list-price estimate (always populated when the session has tokens), and
/// `cost_usd` is the headline figure — recorded when known, else estimated.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageRecord {
    pub session_id: String,
    pub source: String,
    pub model: Option<String>,
    pub account_id: Option<String>,
    pub key_source: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
    pub context_tokens: i64,
    pub recorded_cost_usd: f64,
    pub estimated_cost_usd: f64,
    pub cost_usd: f64,
    /// `native` | `imported` | `none` — which store the tokens came from.
    pub tokens_source: String,
    pub computed_at: String,
}

impl SessionUsageRecord {
    /// Tokens that carry provider cost. Excludes `total_tokens`, which some
    /// writers populate without an input/output split.
    pub fn billable_tokens(&self) -> i64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
    }
}

/// Whether a route's spend is metered by us (hosted key) — i.e. we can report
/// a *recorded* dollar figure — versus a subscription / own-key route where
/// only a list-price *estimate* is available.
fn route_is_metered(key_source: Option<&str>) -> bool {
    key_source.and_then(core_types::key_source::KeySource::parse)
        == Some(core_types::key_source::KeySource::HostedKey)
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
        [table_name],
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(|err| format!("SQL query error: {err}"))
}

/// Session identity fields resolved from whichever store owns the session.
struct OwnerContext {
    source: String,
    model: Option<String>,
    account_id: Option<String>,
    key_source: Option<String>,
}

/// Probe one of the app-owned session tables. Errors (missing table, missing
/// column on an old schema) resolve to `None` — lookups are best-effort.
fn probe_native_owner(
    conn: &Connection,
    table_name: &str,
    source: &'static str,
    session_id: &str,
) -> Option<OwnerContext> {
    conn.query_row(
        &format!("SELECT model, account_id, key_source FROM {table_name} WHERE session_id = ?1"),
        [session_id],
        |row| {
            Ok(OwnerContext {
                source: source.to_string(),
                model: row.get(0)?,
                account_id: row.get(1)?,
                key_source: row.get(2)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

fn probe_imported_owner(conn: &Connection, session_id: &str) -> Option<OwnerContext> {
    conn.query_row(
        "SELECT source, model FROM imported_history_session_cache
         WHERE session_id = ?1
         ORDER BY updated_at_ms DESC
         LIMIT 1",
        [session_id],
        |row| {
            Ok(OwnerContext {
                source: row.get(0)?,
                model: row
                    .get::<_, String>(1)
                    .map(|model| Some(model).filter(|value| !value.is_empty()))?,
                account_id: None,
                key_source: None,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

fn probe_core_session_owner(conn: &Connection, session_id: &str) -> Option<OwnerContext> {
    let record = SqliteRecordStore::new(conn)
        .get_session(session_id)
        .ok()
        .flatten()?;
    Some(OwnerContext {
        source: record.source,
        model: record.metadata.model,
        account_id: None,
        key_source: record.metadata.key_source,
    })
}

/// Resolve the owning session row, native stores first. `None` means the
/// session is unknown to every store and must not be projected.
fn owner_context(conn: &Connection, session_id: &str) -> Option<OwnerContext> {
    probe_native_owner(conn, "code_sessions", SOURCE_ORGII_CLI_SESSIONS, session_id)
        .or_else(|| {
            probe_native_owner(conn, "agent_sessions", SOURCE_ORGII_RUST_AGENTS, session_id)
        })
        .or_else(|| probe_imported_owner(conn, session_id))
        .or_else(|| probe_core_session_owner(conn, session_id))
}

#[derive(Default)]
struct NativeTotals {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    total_tokens: i64,
    context_tokens: i64,
}

fn native_totals(conn: &Connection, session_id: &str) -> Result<NativeTotals, String> {
    if !table_exists(conn, "session_token_usage")? {
        return Ok(NativeTotals::default());
    }
    conn.query_row(
        "SELECT
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(SUM(cache_read_tokens), 0),
            COALESCE(SUM(cache_write_tokens), 0),
            COALESCE(SUM(total_tokens), 0),
            COALESCE(MAX(context_tokens), 0)
         FROM session_token_usage
         WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(NativeTotals {
                input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                cache_read_tokens: row.get(2)?,
                cache_write_tokens: row.get(3)?,
                total_tokens: row.get(4)?,
                context_tokens: row.get(5)?,
            })
        },
    )
    .map_err(|err| format!("SQL query error: {err}"))
}

fn latest_native_column(conn: &Connection, session_id: &str, column: &str) -> Option<String> {
    conn.query_row(
        &format!(
            "SELECT {column} FROM session_token_usage
             WHERE session_id = ?1 AND {column} IS NOT NULL AND {column} != ''
             ORDER BY created_at DESC
             LIMIT 1"
        ),
        [session_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Tokens/model pulled from `imported_history_session_cache` for one session.
/// `input_tokens` is cache-inclusive (see the cache schema); `cache_read_tokens`
/// / `cache_write_tokens` are the cache portion contained within it.
struct ImportedTokens {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    model: Option<String>,
}

fn imported_tokens(conn: &Connection, session_id: &str) -> Result<Option<ImportedTokens>, String> {
    if !table_exists(conn, "imported_history_session_cache")? {
        return Ok(None);
    }
    conn.query_row(
        "SELECT
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(SUM(cache_read_tokens), 0),
            COALESCE(SUM(cache_write_tokens), 0),
            COALESCE(MAX(model), '')
         FROM imported_history_session_cache
         WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(ImportedTokens {
                input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                cache_read_tokens: row.get(2)?,
                cache_write_tokens: row.get(3)?,
                model: row
                    .get::<_, String>(4)
                    .map(|model| Some(model).filter(|value| !value.is_empty()))?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("SQL query error: {err}"))
    .map(|tokens| tokens.filter(|t| t.input_tokens > 0 || t.output_tokens > 0))
}

fn cost_for(tokens: i64, per_mtok: f64) -> f64 {
    (tokens.max(0) as f64 / 1_000_000.0) * per_mtok
}

/// List-price estimate for the record's tokens. Counts with no input/output
/// split (e.g. Cursor's total-only rollups) price at a blended mean of the
/// input and output rates — an approximation, matching the import pricing in
/// `estimate_cost_blended`.
fn estimated_cost_usd(record: &SessionUsageRecord, pricing: ModelPricing) -> f64 {
    if record.billable_tokens() == 0 && record.total_tokens > 0 {
        return record.total_tokens as f64 / 1_000_000.0
            * (pricing.input_per_mtok + pricing.output_per_mtok)
            / 2.0;
    }
    cost_for(record.input_tokens, pricing.input_per_mtok)
        + cost_for(record.output_tokens, pricing.output_per_mtok)
        + cost_for(record.cache_write_tokens, pricing.cache_creation_per_mtok)
        + cost_for(record.cache_read_tokens, pricing.cache_read_per_mtok)
}

/// Rebuild and upsert the usage/cost projection row for one session.
///
/// Returns the projected record, or `None` when no store knows the session
/// (nothing to attribute the tokens to — the row is skipped, not zeroed).
pub fn recompute_session_usage(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<SessionUsageRecord>, String> {
    let Some(owner) = owner_context(conn, session_id) else {
        return Ok(None);
    };

    let native = native_totals(conn, session_id)?;
    let mut record = SessionUsageRecord {
        session_id: session_id.to_string(),
        source: owner.source,
        model: None,
        account_id: owner
            .account_id
            .or_else(|| latest_native_column(conn, session_id, "account_id")),
        key_source: owner.key_source,
        input_tokens: native.input_tokens,
        output_tokens: native.output_tokens,
        cache_read_tokens: native.cache_read_tokens,
        cache_write_tokens: native.cache_write_tokens,
        total_tokens: native.total_tokens,
        context_tokens: native.context_tokens,
        recorded_cost_usd: 0.0,
        estimated_cost_usd: 0.0,
        cost_usd: 0.0,
        tokens_source: TOKENS_SOURCE_NONE.to_string(),
        computed_at: String::new(),
    };
    let mut model = latest_native_column(conn, session_id, "model").or(owner.model);

    if record.billable_tokens() > 0 {
        record.tokens_source = TOKENS_SOURCE_NATIVE.to_string();
    } else if let Some(imported) = imported_tokens(conn, session_id)? {
        // `input_tokens` is cache-inclusive; recover fresh input by subtracting
        // the cache portion so cost prices cache reads at the cheaper rate and
        // the dashboard shows a real cache split. Total stays cache-inclusive
        // (fresh + output + cache = original input + output).
        let cache_read = imported.cache_read_tokens.max(0);
        let cache_write = imported.cache_write_tokens.max(0);
        record.input_tokens = imported
            .input_tokens
            .saturating_sub(cache_read)
            .saturating_sub(cache_write)
            .max(0);
        record.output_tokens = imported.output_tokens;
        record.cache_read_tokens = cache_read;
        record.cache_write_tokens = cache_write;
        record.total_tokens = imported.input_tokens.saturating_add(imported.output_tokens);
        record.tokens_source = TOKENS_SOURCE_IMPORTED.to_string();
        if model.is_none() {
            model = imported.model;
        }
    } else if record.total_tokens > 0 {
        // Native rows that carry only a total (no split) are still native data.
        record.tokens_source = TOKENS_SOURCE_NATIVE.to_string();
    }
    if record.total_tokens == 0 {
        record.total_tokens = record.billable_tokens();
    }

    let pricing = pricing::resolve_pricing(model.as_deref());
    record.model = model;
    let estimated = estimated_cost_usd(&record, pricing);
    let recorded = if route_is_metered(record.key_source.as_deref()) {
        estimated
    } else {
        0.0
    };
    record.estimated_cost_usd = estimated;
    record.recorded_cost_usd = recorded;
    // Headline cost preserves the historical single-figure semantics:
    // recorded metered spend when known, otherwise the list-price estimate.
    record.cost_usd = if recorded > 0.0 { recorded } else { estimated };
    record.computed_at = Utc::now().to_rfc3339();

    SqliteRecordStore::new(conn).upsert_session_usage(&record)?;
    Ok(Some(record))
}

/// Bounded projection repair for sessions written before the projection table
/// (or its write-path hooks) existed. Only sessions with no projection row
/// are recomputed — the live hooks keep existing rows fresh, so re-projecting
/// them at startup would be redundant work on every launch.
///
/// Returns the number of rows projected. Per-session failures do not stop the
/// pass; the first failure is reported after the remaining sessions ran.
pub fn backfill_session_usage(conn: &Connection, limit: usize) -> Result<usize, String> {
    let limit_param = limit.min(i64::MAX as usize) as i64;
    let mut candidates: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut collect = |sql: &str| -> Result<(), String> {
        let mut statement = conn.prepare(sql).map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([limit_param], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?;
        for row in rows {
            let session_id = row.map_err(|err| err.to_string())?;
            if seen.insert(session_id.clone()) {
                candidates.push(session_id);
            }
        }
        Ok(())
    };

    if table_exists(conn, "session_token_usage")? {
        collect(
            "SELECT DISTINCT session_id FROM session_token_usage
             WHERE session_id NOT IN (SELECT session_id FROM orgtrack_core_session_usage)
             LIMIT ?1",
        )?;
    }
    if table_exists(conn, "imported_history_session_cache")? {
        collect(
            "SELECT DISTINCT session_id FROM imported_history_session_cache
             WHERE (input_tokens > 0 OR output_tokens > 0)
               AND session_id NOT IN (SELECT session_id FROM orgtrack_core_session_usage)
             LIMIT ?1",
        )?;
    }

    let mut projected = 0usize;
    let mut first_error: Option<String> = None;
    for session_id in candidates.into_iter().take(limit) {
        match recompute_session_usage(conn, &session_id) {
            Ok(Some(_)) => projected += 1,
            Ok(None) => {}
            Err(err) => {
                first_error.get_or_insert(err);
            }
        }
    }
    match first_error {
        Some(err) => Err(format!(
            "session usage backfill projected {projected} rows; first failure: {err}"
        )),
        None => Ok(projected),
    }
}

#[cfg(test)]
mod tests;
