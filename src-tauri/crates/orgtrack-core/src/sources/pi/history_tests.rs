use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::*;
use crate::sources::imported_history::{cache as imported_cache, watermark};

fn fixture_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    crate::store::sqlite::SqliteRecordStore::init_tables(&conn).expect("init core tables");
    crate::store::sqlite::SqliteRecordStore::init_source_cache_tables(&conn)
        .expect("init source cache tables");
    conn
}

fn temp_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "orgii-pi-history-test-{tag}-{}",
        std::process::id()
    ));
    fs::remove_dir_all(&root).ok();
    fs::create_dir_all(&root).expect("create temp root");
    root
}

fn test_config(root: &Path) -> AnthropicJsonlSource {
    AnthropicJsonlSource {
        source: SOURCE_PI,
        session_prefix: PI_SESSION_PREFIX,
        provider_slug: "pi",
        display_name: "Pi",
        parser_version: 1,
        candidate_roots: vec![root.to_path_buf()],
        exclude_subagent_dirs: false,
        max_discovery_depth: Some(1),
        incremental_metadata: true,
        session_id_from_header: true,
    }
}

fn transcript(header_id: &str, output: i64) -> String {
    format!(
        "{{\"type\":\"session\",\"id\":\"{header_id}\",\"timestamp\":\"2026-07-12T17:37:26.479Z\",\"cwd\":\"/repo\"}}\n\
         {{\"type\":\"message\",\"id\":\"u1\",\"timestamp\":\"2026-07-12T17:37:27.000Z\",\"message\":{{\"role\":\"user\",\"content\":[{{\"type\":\"text\",\"text\":\"Fix the cache\"}}]}}}}\n\
         {{\"type\":\"message\",\"id\":\"a1\",\"timestamp\":\"2026-07-12T17:37:28.000Z\",\"message\":{{\"role\":\"assistant\",\"model\":\"claude-sonnet-4-5\",\"provider\":\"anthropic\",\"content\":[],\"usage\":{{\"input\":10,\"output\":{output},\"cacheRead\":3,\"cacheWrite\":2,\"totalTokens\":{}}}}}}}\n",
        15 + output
    )
}

fn write_session(root: &Path, project: &str, filename: &str, content: &str) -> PathBuf {
    let dir = root.join(project);
    fs::create_dir_all(&dir).expect("create project dir");
    let path = dir.join(filename);
    fs::write(&path, content).expect("write transcript");
    path
}

#[test]
fn pi_uses_header_identity_and_keeps_omp_identity_disjoint() {
    let root = temp_root("identity");
    write_session(
        &root,
        "--repo--",
        "2026-07-12_session-a.jsonl",
        &transcript("session-a", 7),
    );
    let mut conn = fixture_conn();
    let page = anthropic_jsonl::list_sessions_paginated(&test_config(&root), &mut conn, 10, 0)
        .expect("scan Pi");

    assert_eq!(page.sessions.len(), 1);
    assert_eq!(page.sessions[0].session_id, "piapp-session-a");
    assert!(!page.sessions[0].session_id.starts_with("ompapp-"));
    assert_eq!(page.sessions[0].name, "Fix the cache");
    assert_eq!(page.sessions[0].total_tokens, 22);

    let chunks = anthropic_jsonl::load_session(&test_config(&root), &conn, "piapp-session-a")
        .expect("load by canonical header id");
    assert!(!chunks.is_empty());
    fs::remove_dir_all(root).ok();
}

#[test]
fn append_resumes_from_the_previous_complete_offset() {
    let root = temp_root("append");
    let path = write_session(
        &root,
        "--repo--",
        "2026-07-12_session-a.jsonl",
        &transcript("session-a", 7),
    );
    let mut conn = fixture_conn();
    let config = test_config(&root);
    anthropic_jsonl::list_sessions_paginated(&config, &mut conn, 10, 0).expect("cold scan");
    let first = watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_PI,
        "--repo--/2026-07-12_session-a",
    )
    .expect("read watermark")
    .expect("watermark exists");

    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .and_then(|mut file| {
            writeln!(
                file,
                "{{\"type\":\"message\",\"id\":\"a2\",\"timestamp\":\"2026-07-12T17:37:29.000Z\",\"message\":{{\"role\":\"assistant\",\"model\":\"claude-sonnet-4-5\",\"provider\":\"anthropic\",\"content\":[],\"usage\":{{\"input\":4,\"output\":5,\"cacheRead\":1,\"cacheWrite\":0,\"totalTokens\":10}}}}}}"
            )
        })
        .expect("append assistant round");
    let page = anthropic_jsonl::list_sessions_paginated(&config, &mut conn, 10, 0)
        .expect("incremental scan");
    let second = watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_PI,
        "--repo--/2026-07-12_session-a",
    )
    .expect("read next watermark")
    .expect("next watermark exists");

    assert!(second.byte_offset > first.byte_offset);
    assert_eq!(page.sessions[0].total_tokens, 32);
    fs::remove_dir_all(root).ok();
}

#[test]
fn unchanged_scan_keeps_the_parse_watermark_byte_for_byte() {
    let root = temp_root("unchanged");
    write_session(
        &root,
        "--repo--",
        "2026-07-12_session-a.jsonl",
        &transcript("session-a", 7),
    );
    let mut conn = fixture_conn();
    let config = test_config(&root);
    anthropic_jsonl::list_sessions_paginated(&config, &mut conn, 10, 0).expect("cold scan");
    let first = watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_PI,
        "--repo--/2026-07-12_session-a",
    )
    .expect("read watermark")
    .expect("watermark exists");

    anthropic_jsonl::list_sessions_paginated(&config, &mut conn, 10, 0).expect("unchanged scan");
    let second = watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_PI,
        "--repo--/2026-07-12_session-a",
    )
    .expect("read unchanged watermark")
    .expect("watermark remains");

    assert_eq!(second, first);
    fs::remove_dir_all(root).ok();
}

#[test]
fn exact_leaf_depth_ignores_nested_foreign_jsonl() {
    let root = temp_root("depth");
    fs::write(root.join("root-level.jsonl"), transcript("root-level", 99))
        .expect("write root-level foreign file");
    write_session(
        &root,
        "--repo--",
        "session-a.jsonl",
        &transcript("session-a", 1),
    );
    write_session(
        &root.join("--repo--"),
        "nested",
        "foreign.jsonl",
        &transcript("foreign", 99),
    );
    let mut conn = fixture_conn();
    let page = anthropic_jsonl::list_sessions_paginated(&test_config(&root), &mut conn, 10, 0)
        .expect("scan bounded layout");

    assert_eq!(page.sessions.len(), 1);
    assert_eq!(page.sessions[0].session_id, "piapp-session-a");
    fs::remove_dir_all(root).ok();
}

#[test]
fn oversized_append_preserves_the_last_good_cache_and_watermark() {
    let root = temp_root("oversized");
    let path = write_session(
        &root,
        "--repo--",
        "session-a.jsonl",
        &transcript("session-a", 7),
    );
    let mut conn = fixture_conn();
    let config = test_config(&root);
    anthropic_jsonl::list_sessions_paginated(&config, &mut conn, 10, 0).expect("cold scan");
    let before = watermark::read_parse_watermark_from_conn(&conn, SOURCE_PI, "--repo--/session-a")
        .expect("read watermark")
        .expect("watermark exists");

    let oversized = vec![b'x'; watermark::MAX_JSONL_LINE_BYTES + 1];
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .and_then(|mut file| {
            file.write_all(&oversized)?;
            file.write_all(b"\n")
        })
        .expect("append oversized record");
    let error = anthropic_jsonl::list_sessions_paginated(&config, &mut conn, 10, 0)
        .expect_err("oversized append rejected");
    assert!(error.contains("record exceeds"));

    let after = watermark::read_parse_watermark_from_conn(&conn, SOURCE_PI, "--repo--/session-a")
        .expect("read preserved watermark")
        .expect("watermark remains");
    let cached =
        imported_cache::query_cached_session_from_conn(&conn, SOURCE_PI, "--repo--/session-a")
            .expect("read cached row")
            .expect("cached row remains");
    assert_eq!(after, before);
    assert_eq!(cached.output_tokens, 7);
    fs::remove_dir_all(root).ok();
}
