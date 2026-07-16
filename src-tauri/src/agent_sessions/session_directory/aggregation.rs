//! Core aggregation logic for combining sessions from multiple backends.
//!
//! This module provides the main `list_all_sessions` function that loads sessions
//! from CLI, Coding, and OS Agent backends and applies filters, sorting, and
//! pagination. It is a pure read: orgtrack mirroring happens on the session
//! write paths (see `orgtrack_adapter`), never during listing.

use std::collections::HashSet;

use crate::agent_sessions::cli::persistence as cli_session_persistence;
use agent_core::coordination::agent_org_runs::{AgentOrgRunRecord, AgentOrgRunStore};
use agent_core::definitions::orgs::OrgDefinition;
use agent_core::session::persistence::{self as session_persistence, session_type};
use chrono::DateTime;
use core_types::key_source::KeySource;
use database::db::get_connection;
use orgtrack_core::sources::claude_code::history as claude_code_history;
use orgtrack_core::sources::cline::history as cline_history;
use orgtrack_core::sources::codex::app as codex_app_history;
use orgtrack_core::sources::cursor_ide::history as cursor_ide_history;
use orgtrack_core::sources::cursor_ide::history::CursorIdeSessionPage;
use orgtrack_core::sources::imported_history::cache as imported_history_cache;
use orgtrack_core::sources::imported_history::metadata::{
    SOURCE_CLAUDE_CODE, SOURCE_CLINE, SOURCE_CODEX_APP, SOURCE_CURSOR_IDE, SOURCE_OPENCODE,
    SOURCE_TRAE, SOURCE_WARP, SOURCE_WINDSURF, SOURCE_WORKBUDDY, SOURCE_ZCODE,
};
use orgtrack_core::sources::imported_history::ImportedHistorySessionPage;
use orgtrack_core::sources::opencode::history as opencode_history;
use orgtrack_core::sources::trae::history as trae_history;
use orgtrack_core::sources::warp::history as warp_history;
use orgtrack_core::sources::windsurf::history as windsurf_history;
use orgtrack_core::sources::workbuddy as workbuddy_history;
use orgtrack_core::sources::zcode::history as zcode_history;

const AGENT_ORG_ICON_ID: &str = "network";

use super::conversion::{
    cli_session_to_aggregate_record, cursor_ide_history_to_aggregate_record,
    imported_history_to_aggregate_record, os_session_to_aggregate_record,
    sde_session_to_aggregate_record, AgentMetadataResolver,
};
use super::display::matches_text_query;
use super::types::{SessionAggregateRecord, SessionFilter, SessionListResponse};

const IMPORTED_HISTORY_PAGE_SIZE: usize = 500;

enum ExternalHistoryPage {
    Imported(ImportedHistorySessionPage),
    CursorIde(CursorIdeSessionPage),
}

struct ExternalHistorySourceLoader {
    source: &'static str,
    load_page: fn(&mut rusqlite::Connection, usize, usize) -> Result<ExternalHistoryPage, String>,
}

fn load_claude_code_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    claude_code_history::list_claude_code_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_codex_app_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    codex_app_history::list_codex_app_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_cursor_ide_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    cursor_ide_history::list_cursor_ide_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::CursorIde)
}

fn load_opencode_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    opencode_history::list_opencode_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_windsurf_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    windsurf_history::list_windsurf_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_workbuddy_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    workbuddy_history::list_workbuddy_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_trae_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    trae_history::list_trae_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_cline_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    cline_history::list_cline_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_warp_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    warp_history::list_warp_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

fn load_zcode_external_history_page(
    conn: &mut rusqlite::Connection,
    limit: usize,
    offset: usize,
) -> Result<ExternalHistoryPage, String> {
    zcode_history::list_zcode_history_sessions_paginated(conn, limit, offset)
        .map(ExternalHistoryPage::Imported)
}

const EXTERNAL_HISTORY_SOURCE_LOADERS: &[ExternalHistorySourceLoader] = &[
    ExternalHistorySourceLoader {
        source: SOURCE_CLAUDE_CODE,
        load_page: load_claude_code_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_CODEX_APP,
        load_page: load_codex_app_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_CURSOR_IDE,
        load_page: load_cursor_ide_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_OPENCODE,
        load_page: load_opencode_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_WINDSURF,
        load_page: load_windsurf_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_WORKBUDDY,
        load_page: load_workbuddy_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_TRAE,
        load_page: load_trae_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_CLINE,
        load_page: load_cline_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_WARP,
        load_page: load_warp_external_history_page,
    },
    ExternalHistorySourceLoader {
        source: SOURCE_ZCODE,
        load_page: load_zcode_external_history_page,
    },
];

/// Force a source's on-disk store to be re-read and its metadata cache
/// re-synced, discarding the returned page. This runs the exact sync the
/// sidebar/list path performs (re-parsing every record whose signature changed,
/// e.g. after a parser-version bump), so the manual "Rescan" action can refresh
/// counts and names immediately instead of waiting for a lazy list load.
pub fn resync_external_history_source(
    conn: &mut rusqlite::Connection,
    source: &str,
) -> Result<(), String> {
    let loader = EXTERNAL_HISTORY_SOURCE_LOADERS
        .iter()
        .find(|loader| loader.source == source)
        .ok_or_else(|| format!("Unknown external history source: {source}"))?;
    (loader.load_page)(conn, IMPORTED_HISTORY_PAGE_SIZE, 0)?;
    Ok(())
}

fn append_external_history_page(
    records: &mut Vec<SessionAggregateRecord>,
    source: &str,
    page: ExternalHistoryPage,
) -> usize {
    match page {
        ExternalHistoryPage::Imported(page) => {
            let page_len = page.sessions.len();
            records.extend(
                page.sessions
                    .into_iter()
                    .map(|row| imported_history_to_aggregate_record(row, source)),
            );
            page_len
        }
        ExternalHistoryPage::CursorIde(page) => {
            let page_len = page.sessions.len();
            records.extend(
                page.sessions
                    .into_iter()
                    .map(|row| cursor_ide_history_to_aggregate_record(row, source)),
            );
            page_len
        }
    }
}

fn load_imported_history_sessions(
    filter: Option<&SessionFilter>,
) -> Result<Vec<SessionAggregateRecord>, String> {
    let mut conn =
        get_connection().map_err(|err| format!("Failed to open orgtrack cache DB: {err}"))?;
    let mut records = Vec::new();
    let source_filter = filter.and_then(|filter| filter.external_history_source.as_deref());
    let disabled_sources: std::collections::HashSet<&str> = filter
        .and_then(|filter| filter.disabled_external_history_sources.as_ref())
        .map(|sources| sources.iter().map(String::as_str).collect())
        .unwrap_or_default();

    if let Some(session_ids) = filter
        .and_then(|filter| filter.session_ids.as_ref())
        .filter(|session_ids| !session_ids.is_empty())
    {
        for session_id in session_ids {
            let Some((source, session)) =
                imported_history_cache::query_cached_session_by_session_id_from_conn(
                    &conn, session_id,
                )?
            else {
                continue;
            };
            if source_filter.is_some_and(|expected| expected != source.as_str())
                || disabled_sources.contains(source.as_str())
            {
                continue;
            }
            records.push(imported_history_to_aggregate_record(
                session.to_row(),
                &source,
            ));
        }
        return Ok(records);
    }

    let requested_limit = filter
        .and_then(|filter| filter.limit)
        .unwrap_or(IMPORTED_HISTORY_PAGE_SIZE);
    let requested_offset = filter.and_then(|filter| filter.offset).unwrap_or(0);
    let page_limit = requested_limit.min(IMPORTED_HISTORY_PAGE_SIZE);
    let page_offset = if source_filter.is_some() {
        requested_offset
    } else {
        0
    };

    for loader in EXTERNAL_HISTORY_SOURCE_LOADERS {
        if source_filter.is_some_and(|source| source != loader.source) {
            continue;
        }
        if disabled_sources.contains(loader.source) {
            continue;
        }
        let page = (loader.load_page)(&mut conn, page_limit, page_offset)?;
        append_external_history_page(&mut records, loader.source, page);
    }

    Ok(records)
}

// ============================================================================
// Core Aggregation
// ============================================================================

/// Load sessions from the requested sources and compute statistics.
pub fn list_all_sessions(filter: Option<&SessionFilter>) -> Result<SessionListResponse, String> {
    let category_filter = filter.and_then(|filter| filter.category.as_deref());
    let wants_category = |category: &str| -> bool {
        category_filter
            .map(|raw| raw.split(',').map(str::trim).any(|value| value == category))
            .unwrap_or(true)
    };

    let load_cli = wants_category("cli");
    let load_external_history = wants_category("external_history")
        || filter
            .and_then(|filter| filter.external_history_source.as_ref())
            .is_some();
    let load_agent = wants_category("agent");
    let load_os = wants_category("os");
    let mut all_sessions: Vec<SessionAggregateRecord> = Vec::new();
    let mut metadata_resolver = (load_agent || load_os).then(AgentMetadataResolver::new);

    if load_cli {
        let cli_sessions = cli_session_persistence::list_sessions()
            .map_err(|err| format!("Failed to load CLI sessions: {}", err))?;
        all_sessions.reserve(cli_sessions.len());
        for session in cli_sessions {
            all_sessions.push(cli_session_to_aggregate_record(session));
        }
    }

    let include_external_history = filter
        .and_then(|filter| filter.include_external_history)
        .unwrap_or(true);
    if include_external_history && (load_cli || load_external_history) {
        match load_imported_history_sessions(filter) {
            Ok(imported_sessions) => all_sessions.extend(imported_sessions),
            Err(err) => {
                tracing::warn!(error = %err, "session_directory: failed to load orgtrack imported history sessions")
            }
        }
    }

    if load_agent {
        let sde_filter = agent_core::session::SessionListFilter {
            type_name: Some(session_type::CODING.to_string()),
            ..Default::default()
        };
        let sde_sessions = session_persistence::list_sessions(&sde_filter)
            .map_err(|err| format!("Failed to load SDE Agent sessions: {}", err))?;
        all_sessions.reserve(sde_sessions.len());
        let resolver = metadata_resolver
            .as_mut()
            .expect("agent metadata resolver initialized for agent sessions");
        for session in sde_sessions {
            all_sessions.push(sde_session_to_aggregate_record(session, resolver));
        }

        let org_member_filter = agent_core::session::SessionListFilter {
            type_name: Some(session_type::ORG_MEMBER.to_string()),
            ..Default::default()
        };
        let org_member_sessions = session_persistence::list_sessions(&org_member_filter)
            .map_err(|err| format!("Failed to load Agent Org member sessions: {}", err))?;
        all_sessions.reserve(org_member_sessions.len());
        let resolver = metadata_resolver
            .as_mut()
            .expect("agent metadata resolver initialized for org member sessions");
        for session in org_member_sessions {
            all_sessions.push(sde_session_to_aggregate_record(session, resolver));
        }

        annotate_agent_org_root_rows(&mut all_sessions)?;
    }

    if load_os {
        let os_filter = agent_core::session::SessionListFilter {
            type_name: Some(session_type::DESKTOP.to_string()),
            ..Default::default()
        };
        let os_sessions = session_persistence::list_sessions(&os_filter)
            .map_err(|err| format!("Failed to load OS Agent sessions: {}", err))?;
        all_sessions.reserve(os_sessions.len());
        let resolver = metadata_resolver
            .as_mut()
            .expect("agent metadata resolver initialized for OS sessions");
        for session in os_sessions {
            all_sessions.push(os_session_to_aggregate_record(session, resolver));
        }
    }
    // Apply filters
    if let Some(filter) = filter {
        apply_filters(&mut all_sessions, filter)?;
    }

    // Apply sorting
    apply_sorting(&mut all_sessions, filter);

    // Source-specific external pages already apply their source offset at load time.
    if let Some(filter) = filter {
        if filter.external_history_source.is_none() {
            apply_pagination(&mut all_sessions, filter);
        }
    }

    Ok(SessionListResponse {
        sessions: all_sessions,
    })
}

// ============================================================================
// Filtering
// ============================================================================

fn parse_epoch_millis(timestamp: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

fn apply_filters(
    sessions: &mut Vec<SessionAggregateRecord>,
    filter: &SessionFilter,
) -> Result<(), String> {
    if let Some(session_ids) = filter
        .session_ids
        .as_ref()
        .filter(|session_ids| !session_ids.is_empty())
    {
        let session_ids = session_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        sessions.retain(|session| session_ids.contains(session.session_id.as_str()));
    }

    if let Some(ref category) = filter.category {
        let categories: Vec<&str> = category.split(',').map(|s| s.trim()).collect();
        sessions.retain(|session| {
            let cat_str = session.category.as_str();
            categories.contains(&cat_str)
                || (categories.contains(&"external_history")
                    && session.external_history_source.is_some())
        });
    }

    if let Some(ref external_history_source) = filter.external_history_source {
        sessions.retain(|session| {
            session.external_history_source.as_deref() == Some(external_history_source.as_str())
        });
    }

    if let Some(ref status) = filter.status {
        let statuses: Vec<&str> = status.split(',').map(|s| s.trim()).collect();
        sessions.retain(|session| statuses.contains(&session.status.as_str()));
    }

    if let Some(ref key_source) = filter.key_source {
        // Reject typo'd / unknown values instead of silently mapping them
        // to OwnKey, which would mis-filter the entire result set.
        let ks = KeySource::parse(key_source)
            .ok_or_else(|| format!("Unknown key_source filter: {key_source:?}"))?;
        sessions.retain(|session| session.key_source == ks);
    }

    if let Some(created_after_ms) = filter.created_after_ms {
        sessions.retain(|session| {
            parse_epoch_millis(&session.created_at)
                .map(|created_at_ms| created_at_ms >= created_after_ms)
                .unwrap_or(false)
        });
    }

    if let Some(created_before_ms) = filter.created_before_ms {
        sessions.retain(|session| {
            parse_epoch_millis(&session.created_at)
                .map(|created_at_ms| created_at_ms <= created_before_ms)
                .unwrap_or(false)
        });
    }

    if let Some(ref repo_path) = filter.repo_path {
        sessions.retain(|session| {
            session
                .repo_path
                .as_ref()
                .map(|p| p.starts_with(repo_path))
                .unwrap_or(false)
        });
    }

    if let Some(ref org_id) = filter.org_id {
        sessions.retain(|session| session.org_id.as_deref() == Some(org_id.as_str()));
    }

    if let Some(ref project_slug) = filter.project_slug {
        sessions.retain(|session| session.project_slug.as_deref() == Some(project_slug.as_str()));
    }

    if let Some(ref work_item_id) = filter.work_item_id {
        sessions.retain(|session| session.work_item_id.as_deref() == Some(work_item_id.as_str()));
    }

    // Text search filter
    if let Some(ref query) = filter.text_query {
        if !query.trim().is_empty() {
            sessions.retain(|session| matches_text_query(session, query));
        }
    }

    // Active only filter
    if filter.active_only == Some(true) {
        sessions.retain(|session| session.is_active);
    }

    Ok(())
}

// ============================================================================
// Sorting
// ============================================================================

fn apply_sorting(sessions: &mut [SessionAggregateRecord], filter: Option<&SessionFilter>) {
    let sort_by = filter
        .as_ref()
        .and_then(|f| f.sort_by.as_deref())
        .unwrap_or("updated_at");
    let sort_desc = filter
        .as_ref()
        .and_then(|f| f.sort_order.as_deref())
        .map(|order| order != "asc")
        .unwrap_or(true);

    match sort_by {
        "created_at" => {
            if sort_desc {
                sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            } else {
                sessions.sort_by(|a, b| a.created_at.cmp(&b.created_at));
            }
        }
        "name" => {
            if sort_desc {
                sessions.sort_by(|a, b| b.name.to_lowercase().cmp(&a.name.to_lowercase()));
            } else {
                sessions.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            }
        }
        _ => {
            // Default: updated_at
            if sort_desc {
                sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            } else {
                sessions.sort_by(|a, b| a.updated_at.cmp(&b.updated_at));
            }
        }
    }
}

// ============================================================================
// Pagination
// ============================================================================

fn apply_pagination(sessions: &mut Vec<SessionAggregateRecord>, filter: &SessionFilter) {
    if let Some(offset) = filter.offset {
        if offset < sessions.len() {
            *sessions = sessions.drain(offset..).collect();
        } else {
            sessions.clear();
        }
    }
    if let Some(limit) = filter.limit {
        sessions.truncate(limit);
    }
}

fn agent_org_display_name(run: &AgentOrgRunRecord) -> String {
    run.org_snapshot_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<OrgDefinition>(json).ok())
        .map(|org| org.name)
        .unwrap_or_else(|| run.org_id.clone())
}

fn annotate_agent_org_root_rows(sessions: &mut [SessionAggregateRecord]) -> Result<(), String> {
    let root_session_ids: std::collections::HashMap<String, (String, String)> =
        AgentOrgRunStore::list_runs(usize::MAX)?
            .into_iter()
            .filter_map(|run| {
                let root_session_id = run.root_session_id.clone()?;
                let org_name = agent_org_display_name(&run);
                Some((root_session_id, (run.org_id, org_name)))
            })
            .collect();
    if root_session_ids.is_empty() {
        return Ok(());
    }

    for session in sessions {
        if let Some((org_id, org_name)) = root_session_ids.get(&session.session_id) {
            session.agent_icon_id = Some(AGENT_ORG_ICON_ID.to_string());
            session.agent_org_id = Some(org_id.clone());
            session.agent_org_name = Some(org_name.clone());
        }
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_sessions::session_directory::display::generate_display_label;
    use crate::agent_sessions::session_directory::status::is_active_status;
    use crate::agent_sessions::session_directory::types::SessionCategory;

    fn make_session(
        id: &str,
        status: &str,
        category: SessionCategory,
        key_source: KeySource,
    ) -> SessionAggregateRecord {
        let name = format!("Session {}", id);
        SessionAggregateRecord {
            session_id: id.to_string(),
            name: name.clone(),
            status: status.to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T01:00:00Z".to_string(),
            category,
            external_history_source: None,
            user_input: None,
            repo_path: None,
            storage_path: None,
            repo_name: None,
            branch: None,
            model: Some("gpt-4".to_string()),
            account_id: None,
            cli_agent_type: None,
            key_source,
            tier: None,
            pid: None,
            total_tokens: 1000,
            worktree_path: None,
            worktree_branch: None,
            base_branch: None,
            merge_status: None,
            background: false,
            org_id: None,
            project_id: None,
            project_name: None,
            project_slug: None,
            work_item_id: None,
            agent_role: None,
            is_active: is_active_status(status),
            display_label: generate_display_label(&name, None),
            parent_session_id: None,
            org_member_id: None,
            agent_org_id: None,
            agent_org_name: None,
            agent_definition_id: None,
            agent_icon_id: None,
            agent_display_name: None,
            agent_exec_mode: None,
            draft_text: None,
            reply_target_event_id: None,
            pinned: false,
            files_changed: None,
            lines_added: None,
            lines_removed: None,
            touched_files: None,
        }
    }

    #[test]
    fn apply_filters_accepts_known_key_source() {
        let mut sessions = vec![
            make_session("1", "running", SessionCategory::Cli, KeySource::OwnKey),
            make_session("2", "running", SessionCategory::Cli, KeySource::HostedKey),
        ];

        let filter = SessionFilter {
            key_source: Some("hosted_key".to_string()),
            ..Default::default()
        };
        apply_filters(&mut sessions, &filter).expect("known key_source must be Ok");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "2");
    }

    #[test]
    fn apply_filters_matches_canonical_session_ids_exactly() {
        let mut sessions = vec![
            make_session(
                "session-1",
                "completed",
                SessionCategory::Cli,
                KeySource::OwnKey,
            ),
            make_session(
                "session-10",
                "completed",
                SessionCategory::Cli,
                KeySource::OwnKey,
            ),
        ];
        let filter = SessionFilter {
            session_ids: Some(vec!["session-1".to_string()]),
            ..Default::default()
        };

        apply_filters(&mut sessions, &filter).expect("session ID filter");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "session-1");
    }

    #[test]
    fn apply_filters_rejects_unknown_key_source() {
        let mut sessions = vec![make_session(
            "1",
            "running",
            SessionCategory::Cli,
            KeySource::OwnKey,
        )];

        let filter = SessionFilter {
            // Typo: missing "_key" suffix. Previously silently mapped to
            // OwnKey and mis-filtered the entire response.
            key_source: Some("market".to_string()),
            ..Default::default()
        };
        let err =
            apply_filters(&mut sessions, &filter).expect_err("unknown key_source must be rejected");
        assert!(
            err.contains("Unknown key_source filter"),
            "expected explicit rejection, got: {err}"
        );
    }

    #[test]
    fn pagination_does_not_append_org_member_children_for_visible_roots() {
        let root = make_session(
            "root-session",
            "running",
            SessionCategory::Agent,
            KeySource::OwnKey,
        );
        let mut paged_sessions = vec![root];
        let filter = SessionFilter {
            limit: Some(1),
            ..Default::default()
        };
        apply_pagination(&mut paged_sessions, &filter);

        assert_eq!(
            paged_sessions
                .iter()
                .map(|session| session.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["root-session"]
        );
    }
}
