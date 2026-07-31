//! Exact Cursor billing-usage export with an account-scoped last-good cache.
//!
//! This module reads Cursor's dashboard billing export. It intentionally does
//! not read, merge, or write local Cursor session history: billing events and
//! local context history have different identities and combining them would
//! double-count usage. Callers must keep this source labelled
//! [`CursorUsageRecordSource::CursorBillingExport`].
//!
//! Cache identity includes the endpoint and the Key Vault account id. The
//! cached envelope additionally records a fingerprint of the session token, so
//! replacing a credential under the same Key Vault id cannot expose the
//! previous identity's last-good data.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex as StdMutex, Weak};
use std::time::Duration;

use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, AUTHORIZATION, COOKIE, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use uuid::Uuid;

use crate::key_store::{ModelKey, ModelType, KEY_SERVICE};

/// Cursor's exact dashboard billing export.
pub const CURSOR_USAGE_EXPORT_URL: &str =
    "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens";

/// Successful data and failed attempts are both throttled for five minutes.
pub const CURSOR_USAGE_CACHE_FRESHNESS: Duration = Duration::from_secs(5 * 60);

const CURSOR_USAGE_HTTP_TIMEOUT: Duration = Duration::from_secs(8);
const CURSOR_USAGE_CACHE_VERSION: u32 = 1;
const CURSOR_USAGE_ATTEMPT_VERSION: u32 = 1;
const MAX_CURSOR_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_ACTIVE_ACCOUNT_LANES: usize = 64;
const OVERFLOW_ACCOUNT_LANES: usize = 16;

/// Maximum number of Cursor dashboard exports in flight across all accounts.
pub const CURSOR_USAGE_MAX_CONCURRENT_EXPORTS: usize = 3;

static CURSOR_USAGE_NETWORK_PERMITS: Semaphore =
    Semaphore::const_new(CURSOR_USAGE_MAX_CONCURRENT_EXPORTS);

// Equivalent requests for one account share a lane, while unrelated accounts
// can refresh concurrently. Finished lanes are weak and evicted on the next
// lookup. The map is capped; excess simultaneous accounts fall into a fixed
// set of bounded overflow shards rather than growing process memory forever.
static CURSOR_USAGE_SYNC_LANES: LazyLock<CursorUsageSyncLanes> =
    LazyLock::new(CursorUsageSyncLanes::new);

struct CursorUsageSyncLanes {
    active: StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    overflow: [Arc<AsyncMutex<()>>; OVERFLOW_ACCOUNT_LANES],
}

impl CursorUsageSyncLanes {
    fn new() -> Self {
        Self {
            active: StdMutex::new(HashMap::new()),
            overflow: std::array::from_fn(|_| Arc::new(AsyncMutex::new(()))),
        }
    }

    fn lane(&self, key: &str) -> Arc<AsyncMutex<()>> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        active.retain(|_, lane| lane.strong_count() > 0);
        if let Some(lane) = active.get(key).and_then(Weak::upgrade) {
            return lane;
        }
        if active.len() < MAX_ACTIVE_ACCOUNT_LANES {
            let lane = Arc::new(AsyncMutex::new(()));
            active.insert(key.to_string(), Arc::downgrade(&lane));
            return lane;
        }

        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        key.hash(&mut hasher);
        Arc::clone(&self.overflow[hasher.finish() as usize % OVERFLOW_ACCOUNT_LANES])
    }
}

/// A Key Vault Cursor account and its browser session credential.
///
/// `Debug` is implemented manually so the raw session token can never appear
/// in diagnostics.
#[derive(Clone)]
pub struct CursorUsageAccount {
    pub account_id: String,
    session_token: String,
}

impl CursorUsageAccount {
    pub fn new(
        account_id: impl Into<String>,
        session_token: impl Into<String>,
    ) -> Result<Self, CursorUsageError> {
        let account_id = account_id.into();
        let session_token = session_token.into();
        if account_id.trim().is_empty() {
            return Err(CursorUsageError::new(
                CursorUsageFailureKind::InvalidAccount,
                "Cursor account id is empty",
            ));
        }
        if session_token.trim().is_empty() {
            return Err(CursorUsageError::new(
                CursorUsageFailureKind::InvalidAccount,
                "Cursor session token is empty",
            ));
        }
        Ok(Self {
            account_id,
            session_token,
        })
    }

    /// Build an export account from one stored Cursor Key Vault entry.
    pub fn from_model_key(key: &ModelKey) -> Result<Self, CursorUsageError> {
        if key.model_type != ModelType::CursorCli {
            return Err(CursorUsageError::new(
                CursorUsageFailureKind::InvalidAccount,
                format!("Key {} is not a Cursor account", key.id),
            ));
        }
        let token = key
            .session_token
            .as_deref()
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| {
                CursorUsageError::new(
                    CursorUsageFailureKind::InvalidAccount,
                    format!("Cursor account {} has no web session token", key.id),
                )
            })?;
        Self::new(key.id.clone(), token.to_string())
    }

    fn credential_fingerprint(&self) -> String {
        sha256_hex(self.session_token.as_bytes())
    }
}

impl fmt::Debug for CursorUsageAccount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CursorUsageAccount")
            .field("account_id", &self.account_id)
            .field("session_token", &"<redacted>")
            .finish()
    }
}

/// Source identity carried by every billing record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CursorUsageRecordSource {
    CursorBillingExport,
}

/// Whether a metric is exact, derived, or unavailable.
///
/// Unavailable values remain `None`; they are never emitted as a synthetic
/// zero. `Included` and `NoCharge` preserve Cursor's non-numeric cost labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CursorUsageMetricQuality {
    Exact,
    Derived,
    Included,
    NoCharge,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageEventQuality {
    pub input_tokens: CursorUsageMetricQuality,
    pub output_tokens: CursorUsageMetricQuality,
    pub cache_read_tokens: CursorUsageMetricQuality,
    pub cache_write_tokens: CursorUsageMetricQuality,
    pub cost_usd: CursorUsageMetricQuality,
}

/// One row from Cursor's billing export.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageEvent {
    pub occurred_at: String,
    pub occurred_at_ms: i64,
    pub model: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub source: CursorUsageRecordSource,
    pub quality: CursorUsageEventQuality,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageDataQuality {
    pub total_rows: usize,
    pub emitted_rows: usize,
    pub skipped_rows: usize,
    pub complete_rows: usize,
    pub partial_rows: usize,
    pub missing_metric_values: usize,
    pub invalid_metric_values: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageExport {
    pub events: Vec<CursorUsageEvent>,
    pub data_quality: CursorUsageDataQuality,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CursorUsageSnapshotSource {
    Network,
    FreshCache,
    LastGoodCache,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CursorUsageFailureKind {
    InvalidAccount,
    Unauthorized,
    Network,
    InvalidExport,
    Cache,
    AttemptCooldown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageSyncFailure {
    pub kind: CursorUsageFailureKind,
    pub message: String,
}

impl CursorUsageSyncFailure {
    fn new(kind: CursorUsageFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorUsageError {
    pub failure: CursorUsageSyncFailure,
}

impl CursorUsageError {
    fn new(kind: CursorUsageFailureKind, message: impl Into<String>) -> Self {
        Self {
            failure: CursorUsageSyncFailure::new(kind, message),
        }
    }
}

impl fmt::Display for CursorUsageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.failure.message)
    }
}

impl std::error::Error for CursorUsageError {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageSnapshot {
    pub account_id: String,
    pub fetched_at: DateTime<Utc>,
    pub last_sync_attempt_at: Option<DateTime<Utc>>,
    pub source: CursorUsageSnapshotSource,
    pub is_stale: bool,
    pub export: CursorUsageExport,
    pub sync_failure: Option<CursorUsageSyncFailure>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedCursorUsageCache {
    pub archived_last_good: bool,
    pub archived_attempt_marker: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorUsageCacheEnvelope {
    version: u32,
    endpoint: String,
    account_id: String,
    credential_fingerprint: String,
    fetched_at: DateTime<Utc>,
    export: CursorUsageExport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CursorUsageAttemptOutcome {
    Started,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorUsageAttemptMarker {
    version: u32,
    endpoint: String,
    account_id: String,
    credential_fingerprint: String,
    attempted_at: DateTime<Utc>,
    outcome: CursorUsageAttemptOutcome,
    failure: Option<CursorUsageSyncFailure>,
}

/// Account-scoped Cursor billing exporter.
pub struct CursorUsageExporter {
    client: reqwest::Client,
    cache_root: PathBuf,
    endpoint: String,
    freshness: Duration,
}

impl CursorUsageExporter {
    /// Use the default Key Vault data root (`~/.orgii/cache/cursor-usage`).
    pub fn for_key_vault() -> Result<Self, CursorUsageError> {
        Self::new(
            KEY_SERVICE
                .get_storage_dir()
                .join("cache")
                .join("cursor-usage"),
        )
    }

    pub fn new(cache_root: PathBuf) -> Result<Self, CursorUsageError> {
        Self::with_endpoint_and_freshness(
            cache_root,
            CURSOR_USAGE_EXPORT_URL,
            CURSOR_USAGE_CACHE_FRESHNESS,
        )
    }

    /// Constructor with injectable endpoint/freshness for integration tests.
    pub fn with_endpoint_and_freshness(
        cache_root: PathBuf,
        endpoint: impl Into<String>,
        freshness: Duration,
    ) -> Result<Self, CursorUsageError> {
        let client = reqwest::Client::builder()
            .timeout(CURSOR_USAGE_HTTP_TIMEOUT)
            .build()
            .map_err(|error| {
                CursorUsageError::new(
                    CursorUsageFailureKind::Network,
                    format!("Failed to build Cursor usage HTTP client: {error}"),
                )
            })?;
        Ok(Self {
            client,
            cache_root,
            endpoint: endpoint.into(),
            freshness,
        })
    }

    pub fn cache_path_for_account(&self, account_id: &str) -> PathBuf {
        self.cache_root.join(format!(
            "{}.last-good.json",
            self.account_file_stem(account_id)
        ))
    }

    pub fn attempt_marker_path_for_account(&self, account_id: &str) -> PathBuf {
        self.cache_root.join(format!(
            "{}.last-sync-attempt.json",
            self.account_file_stem(account_id)
        ))
    }

    /// Load a fresh account cache or fetch the exact Cursor billing export.
    ///
    /// A failed attempt returns the matching stale last-good cache when one
    /// exists. A recent failure marker suppresses another request for the same
    /// account/credential until the five-minute cooldown expires. `force`
    /// bypasses both freshness gates.
    pub async fn sync_account(
        &self,
        account: &CursorUsageAccount,
        force: bool,
    ) -> Result<CursorUsageSnapshot, CursorUsageError> {
        self.sync_account_with_fetcher(account, force, Utc::now(), || {
            self.fetch_usage_csv(&account.session_token)
        })
        .await
    }

    /// Move an account's active cache into one bounded archive slot.
    ///
    /// The archive is not read automatically. This helper is intended for
    /// logout/account removal: it preserves one recoverable last-good copy
    /// without allowing archives to grow without bound.
    pub async fn archive_account_cache(
        &self,
        account_id: &str,
    ) -> Result<ArchivedCursorUsageCache, CursorUsageError> {
        let lane = CURSOR_USAGE_SYNC_LANES.lane(&self.account_file_stem(account_id));
        let _guard = lane.lock().await;
        let archive_root = self.cache_root.join("archive");
        let stem = self.account_file_stem(account_id);
        let cache_path = self.cache_path_for_account(account_id);
        let attempt_path = self.attempt_marker_path_for_account(account_id);
        let archive_cache_path = archive_root.join(format!("{stem}.last-good.json"));
        let archive_attempt_path = archive_root.join(format!("{stem}.last-sync-attempt.json"));

        let archived_last_good = archive_file_if_present(&cache_path, &archive_cache_path).await?;
        let archived_attempt_marker =
            archive_file_if_present(&attempt_path, &archive_attempt_path).await?;

        Ok(ArchivedCursorUsageCache {
            archived_last_good,
            archived_attempt_marker,
        })
    }

    async fn sync_account_with_fetcher<F, Fut>(
        &self,
        account: &CursorUsageAccount,
        force: bool,
        now: DateTime<Utc>,
        fetcher: F,
    ) -> Result<CursorUsageSnapshot, CursorUsageError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<String, CursorUsageSyncFailure>>,
    {
        let lane = CURSOR_USAGE_SYNC_LANES.lane(&self.account_file_stem(&account.account_id));
        let _guard = lane.lock().await;
        let cached = self.read_matching_cache(account).await;
        let attempt = self.read_matching_attempt(account).await;

        if !force {
            if let Some(envelope) = cached
                .as_ref()
                .filter(|cache| timestamp_is_fresh(cache.fetched_at, now, self.freshness))
            {
                return Ok(snapshot_from_cache(
                    envelope,
                    attempt.as_ref().map(|value| value.attempted_at),
                    CursorUsageSnapshotSource::FreshCache,
                    false,
                    None,
                ));
            }

            if let Some(recent_attempt) = attempt
                .as_ref()
                .filter(|marker| timestamp_is_fresh(marker.attempted_at, now, self.freshness))
            {
                let failure = recent_attempt.failure.clone().unwrap_or_else(|| {
                    CursorUsageSyncFailure::new(
                        CursorUsageFailureKind::AttemptCooldown,
                        "Cursor usage sync was already attempted recently",
                    )
                });
                return fallback_or_error(cached.as_ref(), recent_attempt.attempted_at, failure);
            }
        }

        // This permit is intentionally acquired after both cache gates. Fresh
        // reads and cooldown fallbacks never join the upstream queue.
        let network_permit = match CURSOR_USAGE_NETWORK_PERMITS.acquire().await {
            Ok(permit) => permit,
            Err(_) => {
                let failure = CursorUsageSyncFailure::new(
                    CursorUsageFailureKind::Network,
                    "Cursor usage network queue is unavailable",
                );
                return fallback_or_error(cached.as_ref(), now, failure);
            }
        };

        let started_marker =
            self.attempt_marker(account, now, CursorUsageAttemptOutcome::Started, None);
        if let Err(error) = self.write_attempt_marker(&started_marker, account).await {
            let failure = CursorUsageSyncFailure::new(
                CursorUsageFailureKind::Cache,
                format!("Failed to persist Cursor sync-attempt marker: {error}"),
            );
            return fallback_or_error(cached.as_ref(), now, failure);
        }

        let fetch_result = fetcher().await;
        drop(network_permit);
        let fetched = match fetch_result {
            Ok(csv) => parse_cursor_usage_csv(&csv).map_err(|message| {
                CursorUsageSyncFailure::new(CursorUsageFailureKind::InvalidExport, message)
            }),
            Err(failure) => Err(failure),
        };

        let export = match fetched {
            Ok(export) => export,
            Err(failure) => {
                let failed_marker = self.attempt_marker(
                    account,
                    now,
                    CursorUsageAttemptOutcome::Failed,
                    Some(failure.clone()),
                );
                let _ = self.write_attempt_marker(&failed_marker, account).await;
                return fallback_or_error(cached.as_ref(), now, failure);
            }
        };

        let envelope = CursorUsageCacheEnvelope {
            version: CURSOR_USAGE_CACHE_VERSION,
            endpoint: self.endpoint.clone(),
            account_id: account.account_id.clone(),
            credential_fingerprint: account.credential_fingerprint(),
            fetched_at: now,
            export,
        };

        if let Err(error) = self.write_cache(&envelope, account).await {
            let failure = CursorUsageSyncFailure::new(
                CursorUsageFailureKind::Cache,
                format!("Failed to persist Cursor last-good cache: {error}"),
            );
            let failed_marker = self.attempt_marker(
                account,
                now,
                CursorUsageAttemptOutcome::Failed,
                Some(failure.clone()),
            );
            let _ = self.write_attempt_marker(&failed_marker, account).await;
            return fallback_or_error(cached.as_ref(), now, failure);
        }

        let succeeded_marker =
            self.attempt_marker(account, now, CursorUsageAttemptOutcome::Succeeded, None);
        let marker_failure = self
            .write_attempt_marker(&succeeded_marker, account)
            .await
            .err()
            .map(|error| {
                CursorUsageSyncFailure::new(
                    CursorUsageFailureKind::Cache,
                    format!("Cursor usage synced, but the attempt marker update failed: {error}"),
                )
            });

        Ok(CursorUsageSnapshot {
            account_id: envelope.account_id,
            fetched_at: envelope.fetched_at,
            last_sync_attempt_at: Some(now),
            source: CursorUsageSnapshotSource::Network,
            is_stale: false,
            export: envelope.export,
            sync_failure: marker_failure,
        })
    }

    async fn fetch_usage_csv(&self, session_token: &str) -> Result<String, CursorUsageSyncFailure> {
        let auth_attempts = cursor_auth_attempts(session_token);
        let auth_attempt_count = auth_attempts.len();
        let mut response = None;
        for (index, auth) in auth_attempts.into_iter().enumerate() {
            let current = self
                .client
                .get(&self.endpoint)
                .headers(cursor_headers(&auth)?)
                .send()
                .await
                .map_err(|error| {
                    CursorUsageSyncFailure::new(
                        CursorUsageFailureKind::Network,
                        format!("Cursor usage request failed: {error}"),
                    )
                })?;
            let may_retry_auth = index + 1 < auth_attempt_count;
            if is_auth_failure(current.status()) && may_retry_auth {
                continue;
            }
            response = Some(current);
            break;
        }
        let mut response = response.ok_or_else(|| {
            CursorUsageSyncFailure::new(
                CursorUsageFailureKind::Unauthorized,
                "Cursor web session is expired or unauthorized",
            )
        })?;

        if is_auth_failure(response.status()) {
            return Err(CursorUsageSyncFailure::new(
                CursorUsageFailureKind::Unauthorized,
                "Cursor web session is expired or unauthorized",
            ));
        }
        if !response.status().is_success() {
            return Err(CursorUsageSyncFailure::new(
                CursorUsageFailureKind::Network,
                format!("Cursor usage API returned HTTP {}", response.status()),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CURSOR_EXPORT_BYTES as u64)
        {
            return Err(CursorUsageSyncFailure::new(
                CursorUsageFailureKind::InvalidExport,
                "Cursor usage export exceeds the 64 MiB safety limit",
            ));
        }

        let mut body = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or_default()
                .min(MAX_CURSOR_EXPORT_BYTES as u64) as usize,
        );
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            CursorUsageSyncFailure::new(
                CursorUsageFailureKind::Network,
                format!("Failed to read Cursor usage response: {error}"),
            )
        })? {
            if body.len().saturating_add(chunk.len()) > MAX_CURSOR_EXPORT_BYTES {
                return Err(CursorUsageSyncFailure::new(
                    CursorUsageFailureKind::InvalidExport,
                    "Cursor usage export exceeds the 64 MiB safety limit",
                ));
            }
            body.extend_from_slice(&chunk);
        }

        String::from_utf8(body).map_err(|error| {
            CursorUsageSyncFailure::new(
                CursorUsageFailureKind::InvalidExport,
                format!("Cursor usage export is not UTF-8: {error}"),
            )
        })
    }

    async fn read_matching_cache(
        &self,
        account: &CursorUsageAccount,
    ) -> Option<CursorUsageCacheEnvelope> {
        let contents = tokio::fs::read(self.cache_path_for_account(&account.account_id))
            .await
            .ok()?;
        let envelope: CursorUsageCacheEnvelope = serde_json::from_slice(&contents).ok()?;
        self.cache_matches_account(&envelope, account)
            .then_some(envelope)
    }

    async fn read_matching_attempt(
        &self,
        account: &CursorUsageAccount,
    ) -> Option<CursorUsageAttemptMarker> {
        let contents = tokio::fs::read(self.attempt_marker_path_for_account(&account.account_id))
            .await
            .ok()?;
        let marker: CursorUsageAttemptMarker = serde_json::from_slice(&contents).ok()?;
        self.attempt_matches_account(&marker, account)
            .then_some(marker)
    }

    fn cache_matches_account(
        &self,
        envelope: &CursorUsageCacheEnvelope,
        account: &CursorUsageAccount,
    ) -> bool {
        envelope.version == CURSOR_USAGE_CACHE_VERSION
            && envelope.endpoint == self.endpoint
            && envelope.account_id == account.account_id
            && envelope.credential_fingerprint == account.credential_fingerprint()
    }

    fn attempt_matches_account(
        &self,
        marker: &CursorUsageAttemptMarker,
        account: &CursorUsageAccount,
    ) -> bool {
        marker.version == CURSOR_USAGE_ATTEMPT_VERSION
            && marker.endpoint == self.endpoint
            && marker.account_id == account.account_id
            && marker.credential_fingerprint == account.credential_fingerprint()
    }

    fn attempt_marker(
        &self,
        account: &CursorUsageAccount,
        attempted_at: DateTime<Utc>,
        outcome: CursorUsageAttemptOutcome,
        failure: Option<CursorUsageSyncFailure>,
    ) -> CursorUsageAttemptMarker {
        CursorUsageAttemptMarker {
            version: CURSOR_USAGE_ATTEMPT_VERSION,
            endpoint: self.endpoint.clone(),
            account_id: account.account_id.clone(),
            credential_fingerprint: account.credential_fingerprint(),
            attempted_at,
            outcome,
            failure,
        }
    }

    async fn write_cache(
        &self,
        envelope: &CursorUsageCacheEnvelope,
        account: &CursorUsageAccount,
    ) -> Result<(), CursorUsageError> {
        atomic_write_json(&self.cache_path_for_account(&account.account_id), envelope).await
    }

    async fn write_attempt_marker(
        &self,
        marker: &CursorUsageAttemptMarker,
        account: &CursorUsageAccount,
    ) -> Result<(), CursorUsageError> {
        atomic_write_json(
            &self.attempt_marker_path_for_account(&account.account_id),
            marker,
        )
        .await
    }

    fn account_file_stem(&self, account_id: &str) -> String {
        let scope = format!("{}\0{}", self.endpoint, account_id);
        format!("account-{}", &sha256_hex(scope.as_bytes())[..32])
    }
}

/// Sync one stored Cursor Key Vault account without touching local session
/// history. This is the narrow Rust entry point for background coordinators
/// and command wrappers.
pub async fn sync_key_vault_cursor_billing_usage(
    account_id: String,
    force: bool,
) -> Result<CursorUsageSnapshot, CursorUsageError> {
    let lookup_id = account_id.clone();
    let key = tokio::task::spawn_blocking(move || {
        KEY_SERVICE.get_key_checked(&ModelType::CursorCli, Some(&lookup_id))
    })
    .await
    .map_err(|error| {
        CursorUsageError::new(
            CursorUsageFailureKind::Cache,
            format!("Cursor account lookup task failed: {error}"),
        )
    })?
    .map_err(|error| CursorUsageError::new(CursorUsageFailureKind::Cache, error))?
    .ok_or_else(|| {
        CursorUsageError::new(
            CursorUsageFailureKind::InvalidAccount,
            format!("Cursor account {account_id} was not found"),
        )
    })?;
    let account = CursorUsageAccount::from_model_key(&key)?;
    CursorUsageExporter::for_key_vault()?
        .sync_account(&account, force)
        .await
}

/// Tauri-ready command. The app crate only needs to register this symbol in
/// its handler list; no duplicate fetch/cache implementation is required.
#[tauri::command]
pub async fn cursor_sync_billing_usage(
    account_id: String,
    force: bool,
) -> Result<CursorUsageSnapshot, String> {
    sync_key_vault_cursor_billing_usage(account_id, force)
        .await
        .map_err(|error| error.to_string())
}

/// Tauri-ready logout hook for the bounded, recoverable account archive.
#[tauri::command]
pub async fn cursor_archive_billing_usage_cache(
    account_id: String,
) -> Result<ArchivedCursorUsageCache, String> {
    CursorUsageExporter::for_key_vault()
        .map_err(|error| error.to_string())?
        .archive_account_cache(&account_id)
        .await
        .map_err(|error| error.to_string())
}

enum CursorAuthAttempt {
    Cookie(String),
    Bearer(String),
}

fn cursor_headers(auth: &CursorAuthAttempt) -> Result<HeaderMap, CursorUsageSyncFailure> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/csv,*/*;q=0.9"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.cursor.com/settings"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
        ),
    );
    match auth {
        CursorAuthAttempt::Cookie(session_token) => {
            let cookie =
                HeaderValue::from_str(&format!("WorkosCursorSessionToken={session_token}"))
                    .map_err(|_| {
                        CursorUsageSyncFailure::new(
                            CursorUsageFailureKind::InvalidAccount,
                            "Cursor session token cannot be encoded as an HTTP cookie",
                        )
                    })?;
            headers.insert(COOKIE, cookie);
        }
        CursorAuthAttempt::Bearer(jwt) => {
            let authorization = HeaderValue::from_str(&format!("Bearer {jwt}")).map_err(|_| {
                CursorUsageSyncFailure::new(
                    CursorUsageFailureKind::InvalidAccount,
                    "Cursor session token cannot be encoded as an authorization header",
                )
            })?;
            headers.insert(AUTHORIZATION, authorization);
        }
    }
    Ok(headers)
}

fn is_auth_failure(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
    )
}

fn cursor_auth_attempts(session_token: &str) -> Vec<CursorAuthAttempt> {
    let mut attempts = vec![CursorAuthAttempt::Cookie(session_token.to_string())];
    let raw_jwt = raw_jwt_from_cursor_token(session_token);
    if let Some(alternative) = alternative_cursor_session_token(session_token) {
        push_distinct_auth_attempt(&mut attempts, CursorAuthAttempt::Cookie(alternative));
    }
    if let Some(jwt) = raw_jwt {
        push_distinct_auth_attempt(&mut attempts, CursorAuthAttempt::Bearer(jwt));
    }
    attempts
}

fn push_distinct_auth_attempt(attempts: &mut Vec<CursorAuthAttempt>, candidate: CursorAuthAttempt) {
    let duplicate = attempts
        .iter()
        .any(|existing| match (existing, &candidate) {
            (CursorAuthAttempt::Cookie(left), CursorAuthAttempt::Cookie(right))
            | (CursorAuthAttempt::Bearer(left), CursorAuthAttempt::Bearer(right)) => left == right,
            _ => false,
        });
    if !duplicate {
        attempts.push(candidate);
    }
}

fn raw_jwt_from_cursor_token(token: &str) -> Option<String> {
    if let Some((_, jwt)) = token.split_once("%3A%3A") {
        return (!jwt.is_empty()).then(|| jwt.to_string());
    }
    if let Some((_, jwt)) = token.split_once("::") {
        return (!jwt.is_empty()).then(|| jwt.to_string());
    }
    (token.matches('.').count() >= 2).then(|| token.to_string())
}

fn alternative_cursor_session_token(token: &str) -> Option<String> {
    if let Some(jwt) = raw_jwt_from_cursor_token(token) {
        if token.contains("%3A%3A") || token.contains("::") {
            return Some(jwt);
        }
        return extract_cursor_user_id_from_jwt(&jwt)
            .map(|user_id| format!("{user_id}%3A%3A{jwt}"));
    }
    None
}

fn extract_cursor_user_id_from_jwt(jwt: &str) -> Option<String> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("sub")
        .or_else(|| value.get("user_id"))
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn snapshot_from_cache(
    envelope: &CursorUsageCacheEnvelope,
    last_sync_attempt_at: Option<DateTime<Utc>>,
    source: CursorUsageSnapshotSource,
    is_stale: bool,
    sync_failure: Option<CursorUsageSyncFailure>,
) -> CursorUsageSnapshot {
    CursorUsageSnapshot {
        account_id: envelope.account_id.clone(),
        fetched_at: envelope.fetched_at,
        last_sync_attempt_at,
        source,
        is_stale,
        export: envelope.export.clone(),
        sync_failure,
    }
}

fn fallback_or_error(
    cached: Option<&CursorUsageCacheEnvelope>,
    attempted_at: DateTime<Utc>,
    failure: CursorUsageSyncFailure,
) -> Result<CursorUsageSnapshot, CursorUsageError> {
    if let Some(envelope) = cached {
        return Ok(snapshot_from_cache(
            envelope,
            Some(attempted_at),
            CursorUsageSnapshotSource::LastGoodCache,
            true,
            Some(failure),
        ));
    }
    Err(CursorUsageError { failure })
}

fn timestamp_is_fresh(timestamp: DateTime<Utc>, now: DateTime<Utc>, freshness: Duration) -> bool {
    match now.signed_duration_since(timestamp).to_std() {
        Ok(age) => age < freshness,
        // A future timestamp caused by clock skew should not create an API
        // retry loop while the wall clock recovers.
        Err(_) => true,
    }
}

fn sha256_hex(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), CursorUsageError> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        CursorUsageError::new(
            CursorUsageFailureKind::Cache,
            format!("Failed to serialize Cursor usage cache: {error}"),
        )
    })?;
    atomic_write_bytes(path, &bytes).await
}

async fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), CursorUsageError> {
    let parent = path.parent().ok_or_else(|| {
        CursorUsageError::new(
            CursorUsageFailureKind::Cache,
            "Cursor usage cache path has no parent",
        )
    })?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(cache_io_error)?;
    set_sensitive_directory_permissions(parent).await?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("cursor-usage");
    let temporary_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let write_result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .await
            .map_err(cache_io_error)?;
        file.write_all(bytes).await.map_err(cache_io_error)?;
        file.sync_all().await.map_err(cache_io_error)?;
        set_sensitive_file_permissions(&temporary_path).await?;
        drop(file);
        replace_with_staged_file(&temporary_path, path).await
    }
    .await;

    if write_result.is_err() {
        let _ = tokio::fs::remove_file(&temporary_path).await;
    }
    write_result
}

#[cfg(not(windows))]
async fn replace_with_staged_file(staged: &Path, target: &Path) -> Result<(), CursorUsageError> {
    tokio::fs::rename(staged, target)
        .await
        .map_err(cache_io_error)
}

#[cfg(windows)]
async fn replace_with_staged_file(staged: &Path, target: &Path) -> Result<(), CursorUsageError> {
    // Windows rename does not replace an existing target. Preserve the
    // previous last-good beside it until the staged file is installed, then
    // restore it if installation fails.
    let backup = target.with_extension(format!("backup-{}", Uuid::new_v4()));
    let had_target = tokio::fs::metadata(target).await.is_ok();
    if had_target {
        tokio::fs::rename(target, &backup)
            .await
            .map_err(cache_io_error)?;
    }
    match tokio::fs::rename(staged, target).await {
        Ok(()) => {
            if had_target {
                let _ = tokio::fs::remove_file(backup).await;
            }
            Ok(())
        }
        Err(error) => {
            if had_target {
                let _ = tokio::fs::rename(&backup, target).await;
            }
            Err(cache_io_error(error))
        }
    }
}

async fn set_sensitive_directory_permissions(path: &Path) -> Result<(), CursorUsageError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(cache_io_error)?;
    }
    Ok(())
}

async fn set_sensitive_file_permissions(path: &Path) -> Result<(), CursorUsageError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(cache_io_error)?;
    }
    Ok(())
}

fn cache_io_error(error: std::io::Error) -> CursorUsageError {
    CursorUsageError::new(
        CursorUsageFailureKind::Cache,
        format!("Cursor usage cache I/O failed: {error}"),
    )
}

async fn archive_file_if_present(
    active_path: &Path,
    archive_path: &Path,
) -> Result<bool, CursorUsageError> {
    let bytes = match tokio::fs::read(active_path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(cache_io_error(error)),
    };
    atomic_write_bytes(archive_path, &bytes).await?;
    tokio::fs::remove_file(active_path)
        .await
        .map_err(cache_io_error)?;
    Ok(true)
}

/// Parse Cursor dashboard export CSV by column name rather than positional
/// version. Added/reordered metadata columns therefore do not change token
/// attribution.
pub fn parse_cursor_usage_csv(csv_text: &str) -> Result<CursorUsageExport, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| format!("Invalid Cursor usage CSV header: {error}"))?
        .clone();
    let column = CursorUsageColumns::from_headers(&headers)?;

    let mut export = CursorUsageExport::default();
    for (row_offset, record) in reader.records().enumerate() {
        export.data_quality.total_rows += 1;
        let record = record
            .map_err(|error| format!("Invalid Cursor usage CSV row {}: {error}", row_offset + 2))?;

        let occurred_at = field(&record, column.date).trim();
        let model = field(&record, column.model).trim();
        let Some(occurred_at_ms) = parse_cursor_timestamp(occurred_at) else {
            export.data_quality.skipped_rows += 1;
            continue;
        };
        if model.is_empty() {
            export.data_quality.skipped_rows += 1;
            continue;
        }

        let (input_tokens, input_quality) =
            parse_nonnegative_integer(field(&record, column.input_without_cache_write));
        let (input_with_cache_write, input_with_cache_write_quality) =
            parse_nonnegative_integer(field(&record, column.input_with_cache_write));
        let (cache_read_tokens, cache_read_quality) =
            parse_nonnegative_integer(field(&record, column.cache_read));
        let (output_tokens, output_quality) =
            parse_nonnegative_integer(field(&record, column.output));
        let (cache_write_tokens, cache_write_quality) = match (input_with_cache_write, input_tokens)
        {
            (Some(with_cache_write), Some(without_cache_write)) => (
                Some(with_cache_write.saturating_sub(without_cache_write)),
                CursorUsageMetricQuality::Derived,
            ),
            _ => (
                None,
                combine_unavailable_quality(input_with_cache_write_quality, input_quality),
            ),
        };
        let kind = column.kind.map(|index| field(&record, index));
        let (cost_usd, cost_quality) = parse_cursor_cost(field(&record, column.cost), kind);

        let quality = CursorUsageEventQuality {
            input_tokens: input_quality,
            output_tokens: output_quality,
            cache_read_tokens: cache_read_quality,
            cache_write_tokens: cache_write_quality,
            cost_usd: cost_quality,
        };
        update_data_quality(&mut export.data_quality, &quality);

        export.events.push(CursorUsageEvent {
            occurred_at: occurred_at.to_string(),
            occurred_at_ms,
            model: model.to_string(),
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            cost_usd,
            source: CursorUsageRecordSource::CursorBillingExport,
            quality,
        });
    }

    export.data_quality.emitted_rows = export.events.len();
    if export.data_quality.total_rows > 0 && export.events.is_empty() {
        return Err("Cursor usage CSV contained rows but no valid billing events".to_string());
    }
    Ok(export)
}

struct CursorUsageColumns {
    date: usize,
    kind: Option<usize>,
    model: usize,
    input_with_cache_write: usize,
    input_without_cache_write: usize,
    cache_read: usize,
    output: usize,
    cost: usize,
}

impl CursorUsageColumns {
    fn from_headers(headers: &csv::StringRecord) -> Result<Self, String> {
        Ok(Self {
            date: required_column(headers, &["Date"])?,
            kind: optional_column(headers, &["Kind"]),
            model: required_column(headers, &["Model"])?,
            input_with_cache_write: required_column(headers, &["Input (w/ Cache Write)"])?,
            input_without_cache_write: required_column(headers, &["Input (w/o Cache Write)"])?,
            cache_read: required_column(headers, &["Cache Read"])?,
            output: required_column(headers, &["Output Tokens"])?,
            cost: required_column(headers, &["Cost", "Cost to you"])?,
        })
    }
}

fn required_column(headers: &csv::StringRecord, names: &[&str]) -> Result<usize, String> {
    optional_column(headers, names).ok_or_else(|| {
        format!(
            "Cursor usage CSV is missing required column {}",
            names.join(" or ")
        )
    })
}

fn optional_column(headers: &csv::StringRecord, names: &[&str]) -> Option<usize> {
    headers.iter().position(|header| {
        let normalized = header.trim().trim_start_matches('\u{feff}');
        names.contains(&normalized)
    })
}

fn field(record: &csv::StringRecord, index: usize) -> &str {
    record.get(index).unwrap_or_default()
}

fn parse_nonnegative_integer(value: &str) -> (Option<u64>, CursorUsageMetricQuality) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return (None, CursorUsageMetricQuality::Missing);
    }
    let normalized = trimmed.replace(',', "");
    match normalized.parse::<u64>() {
        Ok(value) => (Some(value), CursorUsageMetricQuality::Exact),
        Err(_) => (None, CursorUsageMetricQuality::Invalid),
    }
}

fn parse_cursor_cost(value: &str, kind: Option<&str>) -> (Option<f64>, CursorUsageMetricQuality) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return (None, CursorUsageMetricQuality::Missing);
    }
    if trimmed.eq_ignore_ascii_case("included") {
        return (None, CursorUsageMetricQuality::Included);
    }
    if trimmed == "-" || kind.is_some_and(|kind| kind.to_ascii_lowercase().contains("no charge")) {
        return (None, CursorUsageMetricQuality::NoCharge);
    }
    let normalized = trimmed.replace(['$', ','], "");
    match normalized.parse::<f64>() {
        Ok(cost) if cost.is_finite() && cost >= 0.0 => {
            (Some(cost), CursorUsageMetricQuality::Exact)
        }
        _ => (None, CursorUsageMetricQuality::Invalid),
    }
}

fn combine_unavailable_quality(
    left: CursorUsageMetricQuality,
    right: CursorUsageMetricQuality,
) -> CursorUsageMetricQuality {
    if matches!(left, CursorUsageMetricQuality::Invalid)
        || matches!(right, CursorUsageMetricQuality::Invalid)
    {
        CursorUsageMetricQuality::Invalid
    } else {
        CursorUsageMetricQuality::Missing
    }
}

fn update_data_quality(summary: &mut CursorUsageDataQuality, quality: &CursorUsageEventQuality) {
    let values = [
        quality.input_tokens,
        quality.output_tokens,
        quality.cache_read_tokens,
        quality.cache_write_tokens,
        quality.cost_usd,
    ];
    let missing = values
        .iter()
        .filter(|value| matches!(value, CursorUsageMetricQuality::Missing))
        .count();
    let invalid = values
        .iter()
        .filter(|value| matches!(value, CursorUsageMetricQuality::Invalid))
        .count();
    summary.missing_metric_values += missing;
    summary.invalid_metric_values += invalid;
    if missing == 0 && invalid == 0 && quality.cost_usd == CursorUsageMetricQuality::Exact {
        summary.complete_rows += 1;
    } else {
        summary.partial_rows += 1;
    }
}

fn parse_cursor_timestamp(value: &str) -> Option<i64> {
    if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        return Some(timestamp.timestamp_millis());
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(timestamp) = NaiveDateTime::parse_from_str(value, format) {
            return Some(Utc.from_utc_datetime(&timestamp).timestamp_millis());
        }
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(12, 0, 0))
        .map(|timestamp| Utc.from_utc_datetime(&timestamp).timestamp_millis())
}

#[cfg(test)]
#[path = "usage_export_tests.rs"]
mod tests;
