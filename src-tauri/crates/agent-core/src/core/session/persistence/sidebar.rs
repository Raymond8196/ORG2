//! Bounded native-session queries used by the sidebar roster.
//!
//! This module owns the question "which session rows belong to this page?"
//! Agent Org run metadata remains owned by `coordination::agent_org_runs`.

use rusqlite::params;

use super::crud::{row_to_record, UNIFIED_SESSION_SELECT};
use super::{session_type, UnifiedSessionRecord};
use crate::session::SessionStatus;
use database::db::get_connection;

/// Return one bounded sidebar page of coding sessions that are not roots
/// of any persisted Agent Org run.
///
/// Root membership is applied before LIMIT/OFFSET, so Agent Org roots and
/// worker rows can never consume capacity from the standalone stream.
pub fn list_standalone_coding_sessions_page(
    limit: usize,
    offset: usize,
) -> Result<Vec<UnifiedSessionRecord>, String> {
    list_coding_sessions_by_root_membership(limit, offset, false)
}

/// Return one bounded sidebar page of distinct coding sessions that are
/// roots of at least one persisted Agent Org run.
///
/// EXISTS avoids duplicate session rows if legacy data contains more than
/// one run for the same root session.
pub fn list_agent_org_root_sessions_page(
    limit: usize,
    offset: usize,
) -> Result<Vec<UnifiedSessionRecord>, String> {
    list_coding_sessions_by_root_membership(limit, offset, true)
}

fn list_coding_sessions_by_root_membership(
    limit: usize,
    offset: usize,
    is_agent_org_root: bool,
) -> Result<Vec<UnifiedSessionRecord>, String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    let root_predicate = if is_agent_org_root {
        "EXISTS (
            SELECT 1
            FROM agent_org_runs r
            WHERE r.root_session_id = s.session_id
        )"
    } else {
        "NOT EXISTS (
            SELECT 1
            FROM agent_org_runs r
            WHERE r.root_session_id = s.session_id
        )"
    };
    let sql = format!(
        "{UNIFIED_SESSION_SELECT}
         WHERE s.session_type = ?1
           AND s.status != ?2
           AND s.parent_session_id IS NULL
           AND {root_predicate}
         ORDER BY s.updated_at DESC, s.session_id DESC
         LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(
            params![
                session_type::CODING,
                SessionStatus::Archived.as_str(),
                limit.min(i64::MAX as usize) as i64,
                offset.min(i64::MAX as usize) as i64,
            ],
            row_to_record,
        )
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ensure_runtime_schemas() {
        let conn = database::db::get_connection().expect("test sqlite connection");
        crate::foundation::persistence::test_schema::ensure_agent_sessions_schema(&conn);
        crate::foundation::persistence::session_snapshots::ensure_tables_with(&conn)
            .expect("agent sessions schema");
        crate::session::persistence::init(&conn).expect("unified session schema");
        crate::coordination::agent_org_runs::init_schema(&conn).expect("Agent Org run schema");
    }

    fn upsert_sidebar_session(
        session_id: &str,
        updated_at: &str,
        status: &str,
        session_type: &str,
        parent_session_id: Option<&str>,
    ) {
        ensure_runtime_schemas();
        super::super::upsert_session(&UnifiedSessionRecord {
            session_id: session_id.to_string(),
            name: format!("sidebar-{session_id}"),
            status: status.to_string(),
            session_type: session_type.to_string(),
            parent_session_id: parent_session_id.map(str::to_string),
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
            ..Default::default()
        })
        .expect("upsert sidebar session");
    }

    fn insert_agent_org_run(run_id: &str, root_session_id: &str, updated_at: &str) {
        ensure_runtime_schemas();
        let conn = database::db::get_connection().expect("test sqlite connection");
        conn.execute(
            "INSERT INTO agent_org_runs (
                id,
                org_id,
                coordinator_agent_id,
                root_session_id,
                entry_mode,
                status,
                created_at,
                updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                run_id,
                format!("org-{run_id}"),
                "builtin:sde",
                root_session_id,
                "standalone_session",
                "running",
                updated_at,
            ],
        )
        .expect("insert Agent Org run");
    }

    #[test]
    fn native_sidebar_pages_split_standalone_sessions_from_agent_org_roots() {
        let _sandbox = test_helpers::test_env::sandbox();

        upsert_sidebar_session(
            "standalone-a",
            "2026-07-29T10:00:00Z",
            "idle",
            session_type::CODING,
            None,
        );
        upsert_sidebar_session(
            "standalone-b",
            "2026-07-29T11:00:00Z",
            "idle",
            session_type::CODING,
            None,
        );
        upsert_sidebar_session(
            "standalone-c",
            "2026-07-29T12:00:00Z",
            "idle",
            session_type::CODING,
            None,
        );
        upsert_sidebar_session(
            "standalone-archived",
            "2026-07-29T13:00:00Z",
            SessionStatus::Archived.as_str(),
            session_type::CODING,
            None,
        );
        upsert_sidebar_session(
            "org-root-a",
            "2026-07-29T09:00:00Z",
            "idle",
            session_type::CODING,
            None,
        );
        upsert_sidebar_session(
            "org-root-b",
            "2026-07-29T14:00:00Z",
            "idle",
            session_type::CODING,
            None,
        );
        upsert_sidebar_session(
            "legacy-coding-worker",
            "2026-07-29T16:00:00Z",
            "running",
            session_type::CODING,
            Some("org-root-b"),
        );
        insert_agent_org_run("run-root-a-old", "org-root-a", "2026-07-29T09:00:00Z");
        insert_agent_org_run("run-root-b", "org-root-b", "2026-07-29T14:00:00Z");
        // Legacy duplicate runs for one root must not duplicate the root session.
        insert_agent_org_run("run-root-a-new", "org-root-a", "2026-07-29T10:00:00Z");
        upsert_sidebar_session(
            "newer-worker",
            "2026-07-29T15:00:00Z",
            "running",
            session_type::ORG_MEMBER,
            Some("org-root-b"),
        );

        let first_standalone =
            list_standalone_coding_sessions_page(2, 0).expect("first standalone page");
        assert_eq!(
            first_standalone
                .iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["standalone-c", "standalone-b"]
        );
        let second_standalone =
            list_standalone_coding_sessions_page(2, 2).expect("second standalone page");
        assert_eq!(
            second_standalone
                .iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["standalone-a"]
        );

        let roots = list_agent_org_root_sessions_page(10, 0).expect("Agent Org root page");
        assert_eq!(
            roots
                .iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["org-root-b", "org-root-a"]
        );
    }

    #[test]
    fn native_sidebar_page_order_has_a_deterministic_session_id_tiebreaker() {
        let _sandbox = test_helpers::test_env::sandbox();
        let tied_at = "2026-07-29T10:00:00Z";
        upsert_sidebar_session("tie-a", tied_at, "idle", session_type::CODING, None);
        upsert_sidebar_session("tie-z", tied_at, "idle", session_type::CODING, None);

        let page =
            list_standalone_coding_sessions_page(10, 0).expect("deterministic standalone page");
        assert_eq!(
            page.iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["tie-z", "tie-a"]
        );
    }

    #[test]
    fn native_sidebar_query_uses_bounded_order_and_root_membership_indexes() {
        let _sandbox = test_helpers::test_env::sandbox();
        ensure_runtime_schemas();
        let conn = database::db::get_connection().expect("test sqlite connection");
        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT s.session_id
                 FROM agent_sessions s
                 WHERE s.session_type = 'sde'
                   AND s.status != 'archived'
                   AND s.parent_session_id IS NULL
                   AND NOT EXISTS (
                       SELECT 1
                       FROM agent_org_runs r
                       WHERE r.root_session_id = s.session_id
                   )
                 ORDER BY s.updated_at DESC, s.session_id DESC
                 LIMIT 11 OFFSET 0",
            )
            .expect("prepare native sidebar query plan");
        let details = stmt
            .query_map([], |row| row.get::<_, String>(3))
            .expect("read query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect query plan")
            .join("\n");

        assert!(
            details.contains("idx_agent_sessions_type_updated"),
            "session page did not use ordered type index:\n{details}"
        );
        assert!(
            details.contains("idx_agent_org_runs_root_session"),
            "root membership probe did not use root-session index:\n{details}"
        );
    }
}
