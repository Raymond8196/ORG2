use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use super::*;

struct TestHome(PathBuf);

impl TestHome {
    fn new(tag: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "orgii-kimi-history-{tag}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create test home");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestHome {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}

fn fixture_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    crate::store::sqlite::SqliteRecordStore::init_tables(&conn).expect("init core tables");
    crate::store::sqlite::SqliteRecordStore::init_source_cache_tables(&conn)
        .expect("init source cache tables");
    conn
}

fn write_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().expect("fixture parent")).expect("create fixture parent");
    fs::write(path, content).expect("write fixture");
}

fn cached_usage(
    conn: &Connection,
    source_session_id: &str,
) -> (String, i64, i64, i64, i64, String) {
    conn.query_row(
        "SELECT model, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, name
         FROM imported_history_session_cache
         WHERE source = ?1 AND source_session_id = ?2",
        [SOURCE_KIMI, source_session_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        },
    )
    .expect("cached Kimi usage")
}

#[test]
fn legacy_usage_dedupes_status_updates_and_config_invalidates_model() {
    let home = TestHome::new("legacy");
    let wire = home
        .path()
        .join(".kimi/sessions/project-a/session-a/wire.jsonl");
    write_file(
        &home.path().join(".kimi/config.json"),
        r#"{"model":"kimi-k3"}"#,
    );
    write_file(
        &wire,
        concat!(
            "{\"type\":\"metadata\",\"protocol_version\":\"1.3\"}\n",
            "{\"timestamp\":1770983400.0,\"message\":{\"type\":\"TurnBegin\",\"payload\":{\"user_input\":\"hello Kimi\"}}}\n",
            "{\"timestamp\":1770983410.0,\"message\":{\"type\":\"StatusUpdate\",\"payload\":{\"token_usage\":{\"input_other\":100,\"output\":20,\"input_cache_read\":50,\"input_cache_creation\":10},\"message_id\":\"msg-1\"}}}\n",
            "{\"timestamp\":1770983411.0,\"message\":{\"type\":\"StatusUpdate\",\"payload\":{\"token_usage\":{\"input_other\":200,\"output\":30,\"input_cache_read\":20,\"input_cache_creation\":0},\"message_id\":\"msg-1\"}}}\n",
            "{\"timestamp\":1770983412.0,\"message\":{\"type\":\"ContentPart\",\"payload\":{\"type\":\"text\",\"text\":\"hello back\"}}}\n",
        ),
    );
    let mut conn = fixture_conn();

    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("first sync");
    assert_eq!(
        cached_usage(&conn, "cli/project-a/session-a"),
        (
            "kimi-k3".to_string(),
            220,
            30,
            20,
            0,
            "hello Kimi".to_string()
        )
    );
    let round_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_history_round_usage
             WHERE source = ?1 AND source_session_id = ?2",
            [SOURCE_KIMI, "cli/project-a/session-a"],
            |row| row.get(0),
        )
        .expect("round count");
    assert_eq!(round_count, 1);

    let session_id = format!("{KIMI_SESSION_PREFIX}cli/project-a/session-a");
    let replay = load_kimi_history_for_session(&conn, &session_id).expect("legacy replay");
    assert_eq!(replay.len(), 2);
    assert_eq!(replay[0].function, imported_history::FUNCTION_USER_MESSAGE);
    assert_eq!(replay[1].function, imported_history::FUNCTION_ASSISTANT);

    write_file(
        &home.path().join(".kimi/config.json"),
        r#"{"model":"kimi-k3.1"}"#,
    );
    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("config refresh");
    assert_eq!(
        cached_usage(&conn, "cli/project-a/session-a").0,
        "kimi-k3.1"
    );
}

#[test]
fn kimi_code_counts_only_turn_scope_and_tracks_concrete_models() {
    let home = TestHome::new("code");
    let wire = home
        .path()
        .join(".kimi-code/sessions/work/session/agents/main/wire.jsonl");
    write_file(
        &wire,
        concat!(
            "{\"type\":\"llm.request\",\"model\":\"k3\",\"time\":1780319377000}\n",
            "{\"type\":\"usage.record\",\"model\":\"__runtime_model__\",\"usage\":{\"inputOther\":100,\"output\":50,\"inputCacheRead\":25,\"inputCacheCreation\":0},\"usageScope\":\"turn\",\"time\":1780319377010}\n",
            "{\"type\":\"usage.record\",\"model\":\"kimi-code/kimi-for-coding\",\"usage\":{\"inputOther\":200,\"output\":75,\"inputCacheRead\":0,\"inputCacheCreation\":10},\"usageScope\":\"turn\",\"time\":1780319377020}\n",
            "{\"type\":\"usage.record\",\"model\":\"ignored\",\"usage\":{\"inputOther\":999,\"output\":999},\"usageScope\":\"session\",\"time\":1780319377030}\n",
            "{\"type\":\"step.end\",\"model\":\"ignored\",\"usage\":{\"inputOther\":888,\"output\":888},\"usageScope\":\"turn\",\"time\":1780319377040}\n",
        ),
    );
    let mut conn = fixture_conn();

    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("Kimi Code sync");

    assert_eq!(
        cached_usage(&conn, "code/work/session/main"),
        (
            "kimi-for-coding".to_string(),
            335,
            125,
            25,
            10,
            "code/work/session/main".to_string()
        )
    );
    let mut stmt = conn
        .prepare(
            "SELECT model FROM imported_history_round_usage
             WHERE source = ?1 ORDER BY seq",
        )
        .expect("prepare models");
    let models = stmt
        .query_map([SOURCE_KIMI], |row| row.get::<_, String>(0))
        .expect("query models")
        .collect::<Result<Vec<_>, _>>()
        .expect("models");
    assert_eq!(models, vec!["k3", "kimi-for-coding"]);
    let session_id = format!("{KIMI_SESSION_PREFIX}code/work/session/main");
    assert!(load_kimi_history_for_session(&conn, &session_id)
        .expect("Kimi Code metadata-only replay")
        .is_empty());
}

#[test]
fn append_refresh_reuses_persisted_state_and_advances_watermark() {
    let home = TestHome::new("append");
    let wire = home
        .path()
        .join(".kimi/sessions/project/session/wire.jsonl");
    write_file(
        &wire,
        "{\"timestamp\":1770983410.0,\"message\":{\"type\":\"StatusUpdate\",\"payload\":{\"token_usage\":{\"input_other\":10,\"output\":2},\"message_id\":\"msg-1\"}}}\n",
    );
    let mut conn = fixture_conn();
    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("cold sync");
    let first = imported_history::watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_KIMI,
        "cli/project/session",
    )
    .expect("read watermark")
    .expect("watermark");

    let changes_before_noop = conn.total_changes();
    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("unchanged warm sync");
    assert_eq!(
        conn.total_changes(),
        changes_before_noop,
        "unchanged warm sync should reuse snapshots/cache without writes"
    );

    let mut file = OpenOptions::new()
        .append(true)
        .open(&wire)
        .expect("open append");
    writeln!(
        file,
        "{{\"timestamp\":1770983420.0,\"message\":{{\"type\":\"StatusUpdate\",\"payload\":{{\"token_usage\":{{\"input_other\":20,\"output\":3,\"input_cache_read\":4}},\"message_id\":\"msg-2\"}}}}}}"
    )
    .expect("append usage");
    file.flush().expect("flush append");

    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("warm sync");
    let second = imported_history::watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_KIMI,
        "cli/project/session",
    )
    .expect("read watermark")
    .expect("watermark");
    assert!(second.byte_offset > first.byte_offset);
    assert_eq!(
        cached_usage(&conn, "cli/project/session"),
        (
            DEFAULT_MODEL.to_string(),
            34,
            5,
            4,
            0,
            "cli/project/session".to_string()
        )
    );
}

#[test]
fn discovery_accepts_only_exact_layouts_and_rejects_symlink_escape() {
    let home = TestHome::new("discovery");
    write_file(
        &home.path().join(".kimi/sessions/group/session/wire.jsonl"),
        "{}\n",
    );
    write_file(&home.path().join(".kimi/sessions/wire.jsonl"), "{}\n");
    write_file(
        &home
            .path()
            .join(".kimi/sessions/group/session/deeper/wire.jsonl"),
        "{}\n",
    );
    write_file(
        &home
            .path()
            .join(".kimi-code/sessions/work/session/agents/main/wire.jsonl"),
        "{}\n",
    );
    write_file(
        &home
            .path()
            .join(".kimi-code/sessions/work/session/not-agents/main/wire.jsonl"),
        "{}\n",
    );
    #[cfg(unix)]
    {
        let outside = home.path().join("outside/group/session");
        fs::create_dir_all(&outside).expect("create outside");
        write_file(&outside.join("wire.jsonl"), "{}\n");
        std::os::unix::fs::symlink(
            home.path().join("outside"),
            home.path().join(".kimi/sessions/link"),
        )
        .expect("create symlink");
    }

    let conn = fixture_conn();
    let discovery = discover_kimi_records_in(&conn, home.path(), None).expect("discover");
    let ids = discovery
        .records
        .iter()
        .map(|record| record.source_session_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["cli/group/session", "code/work/session/main"]);
}

#[test]
fn kimi_code_home_override_stays_inside_external_history_identity() {
    let home = Path::new("/isolated/history-home");
    assert_eq!(kimi_code_home_for(home, None), home.join(".kimi-code"));
    assert_eq!(
        kimi_code_home_for(home, Some(OsStr::new("custom-kimi"))),
        home.join("custom-kimi")
    );
    assert_eq!(
        kimi_code_home_for(home, Some(OsStr::new("/isolated/history-home/custom-kimi"))),
        home.join("custom-kimi")
    );
    assert_eq!(
        kimi_code_home_for(home, Some(OsStr::new("/primary-user/.kimi-code"))),
        home.join(".kimi-code")
    );
    assert_eq!(
        kimi_code_home_for(home, Some(OsStr::new("../escape"))),
        home.join(".kimi-code")
    );
}

#[test]
fn changed_session_batch_cap_leaves_unprocessed_records_eligible() {
    let home = TestHome::new("batch-cap");
    for index in 0..=MAX_CHANGED_SESSIONS_PER_SYNC {
        write_file(
            &home.path().join(format!(
                ".kimi/sessions/group/session-{index:03}/wire.jsonl"
            )),
            &format!(
                "{{\"timestamp\":1770983410.0,\"message\":{{\"type\":\"StatusUpdate\",\"payload\":{{\"token_usage\":{{\"input_other\":1,\"output\":1}},\"message_id\":\"msg-{index}\"}}}}}}\n"
            ),
        );
    }
    let mut conn = fixture_conn();

    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("first bounded sync");
    let first_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_history_session_cache WHERE source = ?1",
            [SOURCE_KIMI],
            |row| row.get(0),
        )
        .expect("first cache count");
    assert_eq!(first_count, MAX_CHANGED_SESSIONS_PER_SYNC as i64);

    sync_kimi_history_cache_in(&mut conn, home.path(), None).expect("second bounded sync");
    let second_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_history_session_cache WHERE source = ?1",
            [SOURCE_KIMI],
            |row| row.get(0),
        )
        .expect("second cache count");
    assert_eq!(second_count, (MAX_CHANGED_SESSIONS_PER_SYNC + 1) as i64);
}
