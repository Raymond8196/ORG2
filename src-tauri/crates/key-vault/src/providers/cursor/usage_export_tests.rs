use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use chrono::{TimeZone, Utc};
use tempfile::TempDir;

use super::*;

const EXACT_CSV: &str = r#"Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
"2026-04-09T20:01:10.528Z","cloud-id","automation-id","On-Demand","composer-2","Yes","350","300","900","25","1275","0.11"
"2026-04-09T18:02:13.576Z","","","Included","claude-sonnet-4","No","100","100","200","10","310","Included"
"#;

fn test_exporter(root: &TempDir) -> CursorUsageExporter {
    crate::test_support::install_crypto_provider_for_tests();
    CursorUsageExporter::with_endpoint_and_freshness(
        root.path().to_path_buf(),
        "https://cursor.test/export",
        CURSOR_USAGE_CACHE_FRESHNESS,
    )
    .expect("build exporter")
}

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 31, 10, 0, 0)
        .single()
        .expect("valid time")
}

fn account(id: &str, token: &str) -> CursorUsageAccount {
    CursorUsageAccount::new(id, token).expect("valid account")
}

#[test]
fn sync_lanes_are_account_scoped() {
    let account_lane = CURSOR_USAGE_SYNC_LANES.lane("account-a");
    let same_account_lane = CURSOR_USAGE_SYNC_LANES.lane("account-a");
    let other_account_lane = CURSOR_USAGE_SYNC_LANES.lane("account-b");

    assert!(Arc::ptr_eq(&account_lane, &same_account_lane));
    assert!(!Arc::ptr_eq(&account_lane, &other_account_lane));
}

#[test]
fn auth_attempts_preserve_cookie_first_and_add_safe_fallbacks() {
    let jwt = "header.eyJzdWIiOiJ1c2VyLTEifQ.signature";
    let prefixed = format!("user-1%3A%3A{jwt}");

    let prefixed_attempts = cursor_auth_attempts(&prefixed);
    assert_eq!(prefixed_attempts.len(), 3);
    assert!(matches!(
        &prefixed_attempts[0],
        CursorAuthAttempt::Cookie(value) if value == &prefixed
    ));
    assert!(matches!(
        &prefixed_attempts[1],
        CursorAuthAttempt::Cookie(value) if value == jwt
    ));
    assert!(matches!(
        &prefixed_attempts[2],
        CursorAuthAttempt::Bearer(value) if value == jwt
    ));

    let raw_attempts = cursor_auth_attempts(jwt);
    assert_eq!(raw_attempts.len(), 3);
    assert!(matches!(
        &raw_attempts[0],
        CursorAuthAttempt::Cookie(value) if value == jwt
    ));
    assert!(matches!(
        &raw_attempts[1],
        CursorAuthAttempt::Cookie(value) if value == &prefixed
    ));
    assert!(matches!(
        &raw_attempts[2],
        CursorAuthAttempt::Bearer(value) if value == jwt
    ));
}

#[tokio::test]
async fn upstream_exports_are_globally_limited_to_three() {
    let root = TempDir::new().expect("temp dir");
    let exporter = Arc::new(test_exporter(&root));
    let started = Arc::new(AtomicUsize::new(0));
    let in_flight = Arc::new(AtomicUsize::new(0));
    let max_in_flight = Arc::new(AtomicUsize::new(0));
    let (release, release_rx) = tokio::sync::watch::channel(false);
    let mut tasks = Vec::new();

    for index in 0..8 {
        let exporter = Arc::clone(&exporter);
        let started = Arc::clone(&started);
        let in_flight = Arc::clone(&in_flight);
        let max_in_flight = Arc::clone(&max_in_flight);
        let mut release_rx = release_rx.clone();
        tasks.push(tokio::spawn(async move {
            let account = account(&format!("concurrency-{index}"), "token");
            exporter
                .sync_account_with_fetcher(&account, true, now(), move || async move {
                    started.fetch_add(1, Ordering::SeqCst);
                    let active = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                    max_in_flight.fetch_max(active, Ordering::SeqCst);
                    while !*release_rx.borrow() {
                        release_rx.changed().await.expect("release sender alive");
                    }
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                    Ok(EXACT_CSV.to_string())
                })
                .await
        }));
    }

    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while started.load(Ordering::SeqCst) < CURSOR_USAGE_MAX_CONCURRENT_EXPORTS {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("three exports should enter the network section");
    assert_eq!(
        started.load(Ordering::SeqCst),
        CURSOR_USAGE_MAX_CONCURRENT_EXPORTS
    );
    assert_eq!(
        max_in_flight.load(Ordering::SeqCst),
        CURSOR_USAGE_MAX_CONCURRENT_EXPORTS
    );

    release.send(true).expect("release queued exports");
    for task in tasks {
        task.await
            .expect("sync task")
            .expect("Cursor export should succeed");
    }
    assert_eq!(
        max_in_flight.load(Ordering::SeqCst),
        CURSOR_USAGE_MAX_CONCURRENT_EXPORTS
    );
}

#[test]
fn parses_exact_v3_fields_and_preserves_non_numeric_cost_quality() {
    let parsed = parse_cursor_usage_csv(EXACT_CSV).expect("parse export");
    assert_eq!(parsed.events.len(), 2);

    let exact = &parsed.events[0];
    assert_eq!(exact.model, "composer-2");
    assert_eq!(exact.input_tokens, Some(300));
    assert_eq!(exact.output_tokens, Some(25));
    assert_eq!(exact.cache_read_tokens, Some(900));
    assert_eq!(exact.cache_write_tokens, Some(50));
    assert_eq!(exact.cost_usd, Some(0.11));
    assert_eq!(exact.source, CursorUsageRecordSource::CursorBillingExport);
    assert_eq!(
        exact.quality.cache_write_tokens,
        CursorUsageMetricQuality::Derived
    );

    let included = &parsed.events[1];
    assert_eq!(included.cost_usd, None);
    assert_eq!(
        included.quality.cost_usd,
        CursorUsageMetricQuality::Included
    );
    assert_eq!(parsed.data_quality.complete_rows, 1);
    assert_eq!(parsed.data_quality.partial_rows, 1);
}

#[test]
fn parses_v1_columns_by_name_and_does_not_turn_unknown_into_zero() {
    let csv = r#"Output Tokens,Date,Cost to you,Model,Cache Read,Input (w/o Cache Write),Input (w/ Cache Write),Total Tokens
"","2025-02-01","NaN","gpt-4o","","5","10",""
"#;
    let parsed = parse_cursor_usage_csv(csv).expect("parse reordered v1");
    let event = &parsed.events[0];
    assert_eq!(event.input_tokens, Some(5));
    assert_eq!(event.cache_write_tokens, Some(5));
    assert_eq!(event.output_tokens, None);
    assert_eq!(
        event.quality.output_tokens,
        CursorUsageMetricQuality::Missing
    );
    assert_eq!(event.cache_read_tokens, None);
    assert_eq!(event.cost_usd, None);
    assert_eq!(event.quality.cost_usd, CursorUsageMetricQuality::Invalid);
    assert_eq!(parsed.data_quality.missing_metric_values, 2);
    assert_eq!(parsed.data_quality.invalid_metric_values, 1);
}

#[test]
fn rejects_structurally_incomplete_exports() {
    let error = parse_cursor_usage_csv("Date,Model,Cost\n2026-01-01,gpt-5,1\n")
        .expect_err("missing token headers must fail");
    assert!(error.contains("Input (w/ Cache Write)"));
}

#[tokio::test]
async fn successful_sync_is_atomic_private_and_fresh_cache_avoids_fetch() {
    let root = TempDir::new().expect("temp dir");
    let exporter = test_exporter(&root);
    let account = account("work/account", "work-token");
    let fetches = Arc::new(AtomicUsize::new(0));

    let first_fetches = Arc::clone(&fetches);
    let first = exporter
        .sync_account_with_fetcher(&account, false, now(), move || {
            first_fetches.fetch_add(1, Ordering::SeqCst);
            async { Ok(EXACT_CSV.to_string()) }
        })
        .await
        .expect("first sync");
    assert_eq!(first.source, CursorUsageSnapshotSource::Network);
    assert_eq!(first.export.events[0].cache_read_tokens, Some(900));

    let second_fetches = Arc::clone(&fetches);
    let second = exporter
        .sync_account_with_fetcher(
            &account,
            false,
            now() + chrono::Duration::minutes(4),
            move || {
                second_fetches.fetch_add(1, Ordering::SeqCst);
                async { Ok("must not be fetched".to_string()) }
            },
        )
        .await
        .expect("fresh cache");
    assert_eq!(second.source, CursorUsageSnapshotSource::FreshCache);
    assert_eq!(fetches.load(Ordering::SeqCst), 1);

    let cache_path = exporter.cache_path_for_account(&account.account_id);
    let marker_path = exporter.attempt_marker_path_for_account(&account.account_id);
    assert!(cache_path.exists());
    assert!(marker_path.exists());
    assert!(cache_path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("account-") && name.ends_with(".last-good.json")));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(cache_path)
                .expect("cache metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(marker_path)
                .expect("marker metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[tokio::test]
async fn failed_refresh_keeps_last_good_and_attempt_marker_prevents_retry_storm() {
    let root = TempDir::new().expect("temp dir");
    let exporter = test_exporter(&root);
    let account = account("personal", "personal-token");
    let stale_time = now() - chrono::Duration::minutes(10);

    exporter
        .sync_account_with_fetcher(&account, false, stale_time, || async {
            Ok(EXACT_CSV.to_string())
        })
        .await
        .expect("seed cache");
    let cache_path = exporter.cache_path_for_account(&account.account_id);
    let original_cache = std::fs::read(&cache_path).expect("read original cache");
    let fetches = Arc::new(AtomicUsize::new(0));

    let first_fetches = Arc::clone(&fetches);
    let fallback = exporter
        .sync_account_with_fetcher(&account, false, now(), move || {
            first_fetches.fetch_add(1, Ordering::SeqCst);
            async {
                Err(CursorUsageSyncFailure::new(
                    CursorUsageFailureKind::Network,
                    "offline",
                ))
            }
        })
        .await
        .expect("last-good fallback");
    assert_eq!(fallback.source, CursorUsageSnapshotSource::LastGoodCache);
    assert!(fallback.is_stale);
    assert_eq!(
        fallback.sync_failure.as_ref().map(|value| value.kind),
        Some(CursorUsageFailureKind::Network)
    );
    assert_eq!(
        std::fs::read(&cache_path).expect("read preserved cache"),
        original_cache
    );

    let second_fetches = Arc::clone(&fetches);
    let cooled_down = exporter
        .sync_account_with_fetcher(
            &account,
            false,
            now() + chrono::Duration::minutes(1),
            move || {
                second_fetches.fetch_add(1, Ordering::SeqCst);
                async { Ok("must not be fetched".to_string()) }
            },
        )
        .await
        .expect("cooldown fallback");
    assert_eq!(cooled_down.source, CursorUsageSnapshotSource::LastGoodCache);
    assert_eq!(fetches.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn invalid_new_export_never_overwrites_last_good() {
    let root = TempDir::new().expect("temp dir");
    let exporter = test_exporter(&root);
    let account = account("work", "token");
    let stale_time = now() - chrono::Duration::minutes(10);

    exporter
        .sync_account_with_fetcher(&account, false, stale_time, || async {
            Ok(EXACT_CSV.to_string())
        })
        .await
        .expect("seed cache");
    let path = exporter.cache_path_for_account(&account.account_id);
    let original = std::fs::read(&path).expect("read original");

    let result = exporter
        .sync_account_with_fetcher(&account, false, now(), || async {
            Ok("<html>login</html>".to_string())
        })
        .await
        .expect("fallback");
    assert_eq!(result.source, CursorUsageSnapshotSource::LastGoodCache);
    assert_eq!(
        result.sync_failure.as_ref().map(|value| value.kind),
        Some(CursorUsageFailureKind::InvalidExport)
    );
    assert_eq!(std::fs::read(path).expect("read cache"), original);
}

#[tokio::test]
async fn credential_rotation_and_account_files_are_isolated() {
    let root = TempDir::new().expect("temp dir");
    let exporter = test_exporter(&root);
    let account_a = account("same-id", "old-token");
    let account_b = account("other-id", "other-token");

    exporter
        .sync_account_with_fetcher(&account_a, false, now(), || async {
            Ok(EXACT_CSV.to_string())
        })
        .await
        .expect("seed A");
    exporter
        .sync_account_with_fetcher(&account_b, false, now(), || async {
            Ok(EXACT_CSV.to_string())
        })
        .await
        .expect("seed B");
    assert_ne!(
        exporter.cache_path_for_account(&account_a.account_id),
        exporter.cache_path_for_account(&account_b.account_id)
    );

    let rotated = account("same-id", "new-token");
    let error = exporter
        .sync_account_with_fetcher(
            &rotated,
            false,
            now() + chrono::Duration::minutes(1),
            || async {
                Err(CursorUsageSyncFailure::new(
                    CursorUsageFailureKind::Unauthorized,
                    "new token rejected",
                ))
            },
        )
        .await
        .expect_err("old credential cache must not cross token identity");
    assert_eq!(error.failure.kind, CursorUsageFailureKind::Unauthorized);
}

#[tokio::test]
async fn logout_archive_is_bounded_and_removes_active_files() {
    let root = TempDir::new().expect("temp dir");
    let exporter = test_exporter(&root);
    let account = account("logout-account", "token");

    exporter
        .sync_account_with_fetcher(&account, false, now(), || async {
            Ok(EXACT_CSV.to_string())
        })
        .await
        .expect("seed cache");
    let cache_path = exporter.cache_path_for_account(&account.account_id);
    let marker_path = exporter.attempt_marker_path_for_account(&account.account_id);

    let archived = exporter
        .archive_account_cache(&account.account_id)
        .await
        .expect("archive account");
    assert_eq!(
        archived,
        ArchivedCursorUsageCache {
            archived_last_good: true,
            archived_attempt_marker: true,
        }
    );
    assert!(!cache_path.exists());
    assert!(!marker_path.exists());

    let archive_files = std::fs::read_dir(root.path().join("archive"))
        .expect("archive dir")
        .count();
    assert_eq!(archive_files, 2);

    let archived_again = exporter
        .archive_account_cache(&account.account_id)
        .await
        .expect("empty archive");
    assert_eq!(archived_again, ArchivedCursorUsageCache::default());
}
