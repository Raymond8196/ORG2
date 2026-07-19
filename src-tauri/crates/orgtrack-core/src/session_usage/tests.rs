    use super::*;
    use rusqlite::params;

    fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        SqliteRecordStore::init_tables(&conn).expect("init orgtrack tables");
        SqliteRecordStore::init_source_cache_tables(&conn).expect("init source cache tables");
        // Minimal copies of the app-owned tables the projection reads.
        conn.execute_batch(
            "CREATE TABLE session_token_usage (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id         TEXT NOT NULL,
                session_type       TEXT NOT NULL,
                model              TEXT,
                account_id         TEXT,
                input_tokens       INTEGER NOT NULL DEFAULT 0,
                output_tokens      INTEGER NOT NULL DEFAULT 0,
                cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
                cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens       INTEGER NOT NULL DEFAULT 0,
                context_tokens     INTEGER NOT NULL DEFAULT 0,
                context_usage_json TEXT,
                created_at         TEXT NOT NULL
             );
             CREATE TABLE code_sessions (
                session_id TEXT PRIMARY KEY,
                model      TEXT,
                account_id TEXT,
                key_source TEXT
             );",
        )
        .expect("create app-owned tables");
        conn
    }

    fn insert_turn(
        conn: &Connection,
        session_id: &str,
        model: Option<&str>,
        tokens: (i64, i64, i64, i64, i64, i64),
        created_at: &str,
    ) {
        let (input, output, cache_read, cache_write, total, context) = tokens;
        conn.execute(
            "INSERT INTO session_token_usage (
                session_id, session_type, model, account_id, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, total_tokens, context_tokens, created_at
             ) VALUES (?1, 'code', ?2, 'acct-1', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                session_id, model, input, output, cache_read, cache_write, total, context,
                created_at
            ],
        )
        .expect("insert token usage row");
    }

    fn insert_code_session(conn: &Connection, session_id: &str, key_source: &str) {
        conn.execute(
            "INSERT INTO code_sessions (session_id, model, account_id, key_source)
             VALUES (?1, 'claude-sonnet-4-5', 'acct-1', ?2)",
            params![session_id, key_source],
        )
        .expect("insert code session");
    }

    fn insert_imported(conn: &Connection, session_id: &str, model: &str, tokens: (i64, i64)) {
        conn.execute(
            "INSERT INTO imported_history_session_cache (
                source, source_session_id, session_id, name, model,
                input_tokens, output_tokens, updated_at
             ) VALUES ('claude_code', ?1, ?2, 'Imported', ?3, ?4, ?5, '2026-07-16T00:00:00Z')",
            params![session_id, session_id, model, tokens.0, tokens.1],
        )
        .expect("insert imported cache row");
    }

    #[test]
    fn native_rollups_sum_tokens_and_max_context() {
        let conn = fixture_conn();
        insert_code_session(&conn, "s-native", "own_key");
        insert_turn(
            &conn,
            "s-native",
            Some("claude-sonnet-4-5"),
            (1_000_000, 100_000, 200_000, 50_000, 1_350_000, 90_000),
            "2026-07-16T00:00:01Z",
        );
        insert_turn(
            &conn,
            "s-native",
            Some("claude-opus-4-5"),
            (500_000, 50_000, 0, 0, 550_000, 40_000),
            "2026-07-16T00:00:02Z",
        );

        let record = recompute_session_usage(&conn, "s-native")
            .expect("recompute")
            .expect("projected");
        assert_eq!(record.input_tokens, 1_500_000);
        assert_eq!(record.output_tokens, 150_000);
        assert_eq!(record.cache_read_tokens, 200_000);
        assert_eq!(record.cache_write_tokens, 50_000);
        assert_eq!(record.total_tokens, 1_900_000);
        // Context is a fill level: MAX across turns, not SUM.
        assert_eq!(record.context_tokens, 90_000);
        // Model comes from the latest token row, not the first.
        assert_eq!(record.model.as_deref(), Some("claude-opus-4-5"));
        assert_eq!(record.tokens_source, TOKENS_SOURCE_NATIVE);
        assert_eq!(record.source, SOURCE_ORGII_CLI_SESSIONS);
        assert_eq!(record.account_id.as_deref(), Some("acct-1"));

        let pricing = pricing::resolve_pricing(Some("claude-opus-4-5"));
        let expected = 1.5 * pricing.input_per_mtok
            + 0.15 * pricing.output_per_mtok
            + 0.05 * pricing.cache_creation_per_mtok
            + 0.2 * pricing.cache_read_per_mtok;
        assert!((record.estimated_cost_usd - expected).abs() < 1e-9);
        // Own-key route: estimate only, no recorded metered spend.
        assert_eq!(record.recorded_cost_usd, 0.0);
        assert!((record.cost_usd - expected).abs() < 1e-9);

        let stored = SqliteRecordStore::new(&conn)
            .get_session_usage("s-native")
            .expect("read projection")
            .expect("projection row");
        assert_eq!(stored, record);
    }

    #[test]
    fn hosted_key_route_records_metered_spend() {
        let conn = fixture_conn();
        insert_code_session(&conn, "s-hosted", "hosted_key");
        insert_turn(
            &conn,
            "s-hosted",
            Some("claude-sonnet-4-5"),
            (2_000_000, 1_000_000, 0, 0, 3_000_000, 10_000),
            "2026-07-16T00:00:01Z",
        );

        let record = recompute_session_usage(&conn, "s-hosted")
            .expect("recompute")
            .expect("projected");
        assert!(record.estimated_cost_usd > 0.0);
        assert_eq!(record.recorded_cost_usd, record.estimated_cost_usd);
        assert_eq!(record.cost_usd, record.recorded_cost_usd);
    }

    #[test]
    fn imported_tokens_are_a_fallback_not_an_addend() {
        let conn = fixture_conn();
        insert_imported(&conn, "s-imported", "claude-sonnet-4-5", (400_000, 100_000));

        let record = recompute_session_usage(&conn, "s-imported")
            .expect("recompute")
            .expect("projected");
        assert_eq!(record.tokens_source, TOKENS_SOURCE_IMPORTED);
        assert_eq!(record.input_tokens, 400_000);
        assert_eq!(record.output_tokens, 100_000);
        assert_eq!(record.total_tokens, 500_000);
        assert_eq!(record.source, "claude_code");
        assert_eq!(record.model.as_deref(), Some("claude-sonnet-4-5"));
        let pricing = pricing::resolve_pricing(Some("claude-sonnet-4-5"));
        let expected = 0.4 * pricing.input_per_mtok + 0.1 * pricing.output_per_mtok;
        assert!((record.estimated_cost_usd - expected).abs() < 1e-9);

        // Once native billable tokens exist, imported tokens are ignored
        // entirely (never summed with native ones).
        insert_code_session(&conn, "s-imported", "own_key");
        insert_turn(
            &conn,
            "s-imported",
            Some("claude-sonnet-4-5"),
            (10_000, 1_000, 0, 0, 11_000, 5_000),
            "2026-07-16T00:00:01Z",
        );
        let record = recompute_session_usage(&conn, "s-imported")
            .expect("recompute with native rows")
            .expect("projected");
        assert_eq!(record.tokens_source, TOKENS_SOURCE_NATIVE);
        assert_eq!(record.input_tokens, 10_000);
        assert_eq!(record.total_tokens, 11_000);
    }

    #[test]
    fn imported_cache_is_split_from_inclusive_input() {
        // Imported input is cache-inclusive: 100 fresh + 800 cache_read + 50
        // cache_write = 950 stored input. The projection must recover the split.
        let conn = fixture_conn();
        conn.execute(
            "INSERT INTO imported_history_session_cache (
                source, source_session_id, session_id, name, model,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, updated_at
             ) VALUES ('claude_code', 's-cache', 's-cache', 'Imported', 'claude-sonnet-4-5',
                       950, 20, 800, 50, '2026-07-18T00:00:00Z')",
            [],
        )
        .expect("insert imported row with cache");

        let record = recompute_session_usage(&conn, "s-cache")
            .expect("recompute")
            .expect("projected");
        assert_eq!(record.tokens_source, TOKENS_SOURCE_IMPORTED);
        assert_eq!(record.input_tokens, 100); // 950 - 800 - 50
        assert_eq!(record.cache_read_tokens, 800);
        assert_eq!(record.cache_write_tokens, 50);
        assert_eq!(record.output_tokens, 20);
        // Total stays cache-inclusive (fresh + output + cache = 950 + 20).
        assert_eq!(record.total_tokens, 970);

        // Cost prices cache reads at the cheaper cache-read rate, not full input.
        let pricing = pricing::resolve_pricing(Some("claude-sonnet-4-5"));
        let expected = 100.0 / 1e6 * pricing.input_per_mtok
            + 20.0 / 1e6 * pricing.output_per_mtok
            + 50.0 / 1e6 * pricing.cache_creation_per_mtok
            + 800.0 / 1e6 * pricing.cache_read_per_mtok;
        assert!((record.estimated_cost_usd - expected).abs() < 1e-9);
    }

    #[test]
    fn total_only_tokens_price_at_blended_rate() {
        let conn = fixture_conn();
        insert_code_session(&conn, "s-cursor", "own_key");
        insert_turn(
            &conn,
            "s-cursor",
            Some("claude-sonnet-4-5"),
            (0, 0, 0, 0, 1_000_000, 0),
            "2026-07-16T00:00:01Z",
        );

        let record = recompute_session_usage(&conn, "s-cursor")
            .expect("recompute")
            .expect("projected");
        assert_eq!(record.tokens_source, TOKENS_SOURCE_NATIVE);
        let pricing = pricing::resolve_pricing(Some("claude-sonnet-4-5"));
        let expected = (pricing.input_per_mtok + pricing.output_per_mtok) / 2.0;
        assert!((record.estimated_cost_usd - expected).abs() < 1e-9);
    }

    #[test]
    fn unknown_session_is_skipped_not_zeroed() {
        let conn = fixture_conn();
        insert_turn(
            &conn,
            "s-orphan",
            Some("claude-sonnet-4-5"),
            (1_000, 100, 0, 0, 1_100, 500),
            "2026-07-16T00:00:01Z",
        );
        assert_eq!(recompute_session_usage(&conn, "s-orphan").expect("recompute"), None);
        assert_eq!(
            SqliteRecordStore::new(&conn)
                .get_session_usage("s-orphan")
                .expect("read projection"),
            None
        );
    }

    #[test]
    fn backfill_projects_only_missing_sessions() {
        let conn = fixture_conn();
        insert_code_session(&conn, "s-a", "own_key");
        insert_turn(
            &conn,
            "s-a",
            Some("claude-sonnet-4-5"),
            (1_000, 100, 0, 0, 1_100, 500),
            "2026-07-16T00:00:01Z",
        );
        insert_imported(&conn, "s-b", "claude-sonnet-4-5", (2_000, 200));

        assert_eq!(backfill_session_usage(&conn, 100).expect("backfill"), 2);
        // Both projected; a second pass finds nothing missing.
        assert_eq!(backfill_session_usage(&conn, 100).expect("re-backfill"), 0);

        let store = SqliteRecordStore::new(&conn);
        assert!(store.get_session_usage("s-a").expect("read s-a").is_some());
        assert!(store.get_session_usage("s-b").expect("read s-b").is_some());

        store.delete_session_usage("s-a").expect("delete s-a");
        assert!(store.get_session_usage("s-a").expect("read deleted").is_none());
    }
