//! Native-CLI resume planning for imported external sessions.
//!
//! An imported transcript is read-only inside ORGII, but the CLI that wrote
//! it can usually reopen the very same conversation (`claude --resume`,
//! `codex resume`, `cursor-agent --resume`). This module owns the mapping
//! from an imported-history cache row to that invocation, so the desktop
//! app (chat-panel TUI terminal) and the `orgtrack` CLI agree on which
//! sources are resumable and how the command line is spelled.
//!
//! Only sources whose CLI has a session-id resume entry point belong here.
//! Notably absent: `cursor_ide` — IDE composers live in `state.vscdb` and
//! share no id space with `cursor-agent`'s `~/.cursor/chats` store (verified
//! empirically: zero overlap), so no CLI can reopen them.

use rusqlite::Connection;
use serde::Serialize;

use super::imported_history::cache::{
    query_cached_session_by_session_id_from_conn, ImportedHistoryCachedSession,
};
use super::imported_history::metadata::{
    SOURCE_CLAUDE_CODE, SOURCE_CODEX_APP, SOURCE_CURSOR_CLI,
};

/// How to hand an imported external session back to the CLI that owns it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliResumePlan {
    /// Imported-history source id the plan derives from.
    pub source: &'static str,
    /// `code_sessions.cli_agent_type` value of the owning CLI, so hosts can
    /// reuse managed-session infrastructure (launch profiles, TUI rows,
    /// managed-mirror dedup) unchanged.
    pub cli_agent_type: &'static str,
    /// Bare binary to launch when no launch-profile override applies.
    pub default_binary: &'static str,
    /// Arguments appended after the binary to reopen the session.
    pub resume_args: Vec<String>,
    /// The session id the CLI itself accepts (bare thread uuid / chat id).
    pub native_session_id: String,
    /// Working directory the resume should run in — the session's recorded
    /// workspace. `None` when the source never recorded one.
    pub cwd: Option<String>,
    /// Whether the CLI can only locate the session from its original
    /// working directory (Claude Code keys session storage on the project
    /// path; Codex and cursor-agent look sessions up globally).
    pub requires_cwd: bool,
}

impl CliResumePlan {
    /// The full resume invocation as one display string, shell-quoted the
    /// same way the chat-panel TUI launcher quotes commands.
    pub fn display_command(&self) -> String {
        std::iter::once(self.default_binary.to_string())
            .chain(self.resume_args.iter().cloned())
            .map(|part| shell_quote(&part))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// POSIX single-quote escaping for display command lines. Safe-charset
/// values pass through unquoted so the common `claude --resume <uuid>`
/// stays copy-paste clean.
pub fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_./:@%+=,-".contains(&byte))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Build the resume plan for one imported session, or `None` when the
/// source has no CLI resume path (or the id shape rules it out).
pub fn cli_resume_plan(
    source: &str,
    source_session_id: &str,
    repo_path: Option<&str>,
) -> Option<CliResumePlan> {
    let cwd = repo_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string);
    match source {
        // Claude Code sessions are `<uuid>.jsonl` under the project slug;
        // the file stem IS the id `--resume` accepts. Non-uuid stems
        // (fixtures, sidecars) are not resumable.
        SOURCE_CLAUDE_CODE => {
            if !is_uuid_like(source_session_id) {
                return None;
            }
            Some(CliResumePlan {
                source: SOURCE_CLAUDE_CODE,
                cli_agent_type: "claude_code",
                default_binary: "claude",
                resume_args: vec!["--resume".to_string(), source_session_id.to_string()],
                native_session_id: source_session_id.to_string(),
                cwd,
                requires_cwd: true,
            })
        }
        // Codex imports key on the rollout file stem
        // (`rollout-<timestamp>-<thread-uuid>`), while `codex resume` takes
        // the bare thread uuid — same suffix extraction the managed-mirror
        // dedup uses.
        SOURCE_CODEX_APP => {
            let thread_uuid = codex_thread_uuid_from_stem(source_session_id)?;
            Some(CliResumePlan {
                source: SOURCE_CODEX_APP,
                cli_agent_type: "codex",
                default_binary: "codex",
                resume_args: vec!["resume".to_string(), thread_uuid.to_string()],
                native_session_id: thread_uuid.to_string(),
                cwd,
                requires_cwd: false,
            })
        }
        // cursor-agent stores one `store.db` per chat uuid; `--resume <id>`
        // reopens it from anywhere.
        SOURCE_CURSOR_CLI => {
            if !is_uuid_like(source_session_id) {
                return None;
            }
            Some(CliResumePlan {
                source: SOURCE_CURSOR_CLI,
                cli_agent_type: "cursor_cli",
                default_binary: "cursor-agent",
                resume_args: vec!["--resume".to_string(), source_session_id.to_string()],
                native_session_id: source_session_id.to_string(),
                cwd,
                requires_cwd: false,
            })
        }
        _ => None,
    }
}

/// Resolve a canonical (prefixed) session id against the imported-history
/// cache and plan its CLI resume. Returns the cache row alongside the plan
/// so hosts can run freshness/availability checks (`source_path` on disk,
/// cwd existence) without a second query. Subagent rows resolve to `None`:
/// their transcripts are children of a conversation the CLI resumes as a
/// whole.
pub fn cli_resume_plan_for_cached_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<(CliResumePlan, ImportedHistoryCachedSession)>, String> {
    let Some((source, session)) = query_cached_session_by_session_id_from_conn(conn, session_id)?
    else {
        return Ok(None);
    };
    if session.parent_session_id.is_some() {
        return Ok(None);
    }
    let plan = cli_resume_plan(
        &source,
        &session.source_session_id,
        session.repo_path.as_deref(),
    );
    Ok(plan.map(|plan| (plan, session)))
}

/// `rollout-<timestamp>-<thread-uuid>` → `<thread-uuid>`. Accepts a bare
/// uuid too (runner bindings and older imports carry that form).
fn codex_thread_uuid_from_stem(stem: &str) -> Option<&str> {
    if is_uuid_like(stem) {
        return Some(stem);
    }
    if stem.len() > 37 {
        let (head, tail) = stem.split_at(stem.len() - 36);
        if head.ends_with('-') && is_uuid_like(tail) {
            return Some(tail);
        }
    }
    None
}

fn is_uuid_like(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            *byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "019f6e88-3bc8-77b3-9f21-30af8dd9a1cd";

    #[test]
    fn claude_plan_uses_resume_flag_and_requires_cwd() {
        let plan = cli_resume_plan(SOURCE_CLAUDE_CODE, UUID, Some("/tmp/project")).expect("plan");
        assert_eq!(plan.cli_agent_type, "claude_code");
        assert_eq!(plan.default_binary, "claude");
        assert_eq!(plan.resume_args, vec!["--resume", UUID]);
        assert_eq!(plan.native_session_id, UUID);
        assert_eq!(plan.cwd.as_deref(), Some("/tmp/project"));
        assert!(plan.requires_cwd);
        assert_eq!(plan.display_command(), format!("claude --resume {UUID}"));
    }

    #[test]
    fn claude_rejects_non_uuid_stems() {
        assert!(cli_resume_plan(SOURCE_CLAUDE_CODE, "claude-meta", None).is_none());
    }

    #[test]
    fn codex_plan_extracts_thread_uuid_from_rollout_stem() {
        let stem = format!("rollout-2026-07-17T13-24-09-{UUID}");
        let plan = cli_resume_plan(SOURCE_CODEX_APP, &stem, None).expect("plan");
        assert_eq!(plan.cli_agent_type, "codex");
        assert_eq!(plan.resume_args, vec!["resume", UUID]);
        assert_eq!(plan.native_session_id, UUID);
        assert!(!plan.requires_cwd);
        assert!(plan.cwd.is_none());
    }

    #[test]
    fn codex_plan_accepts_bare_uuid_and_rejects_boundaryless_suffix() {
        assert!(cli_resume_plan(SOURCE_CODEX_APP, UUID, None).is_some());
        // 36 hex-ish tail without a '-' boundary before it must not match.
        let boundaryless = format!("rollout{UUID}");
        assert!(cli_resume_plan(SOURCE_CODEX_APP, &boundaryless, None).is_none());
    }

    #[test]
    fn cursor_cli_plan_uses_resume_flag_globally() {
        let plan = cli_resume_plan(SOURCE_CURSOR_CLI, UUID, Some("  ")).expect("plan");
        assert_eq!(plan.default_binary, "cursor-agent");
        assert_eq!(plan.resume_args, vec!["--resume", UUID]);
        // Blank repo paths normalize away instead of producing a "  " cwd.
        assert!(plan.cwd.is_none());
        assert!(!plan.requires_cwd);
    }

    #[test]
    fn unsupported_sources_yield_no_plan() {
        for source in ["cursor_ide", "opencode", "windsurf", "definitely_not"] {
            assert!(cli_resume_plan(source, UUID, None).is_none(), "{source}");
        }
    }

    #[test]
    fn display_command_quotes_unsafe_arguments() {
        let mut plan = cli_resume_plan(SOURCE_CLAUDE_CODE, UUID, None).expect("plan");
        plan.resume_args = vec!["--resume".to_string(), "a b'c".to_string()];
        assert_eq!(plan.display_command(), r#"claude --resume 'a b'\''c'"#);
    }

    #[test]
    fn cached_lookup_plans_only_resumable_rows() {
        use crate::sources::imported_history::metadata::{
            ImportedHistoryCacheInput, ImportedHistoryImpactStats,
        };

        let mut conn = Connection::open_in_memory().expect("open");
        crate::store::sqlite::SqliteRecordStore::init_tables(&conn).expect("init core tables");
        crate::store::sqlite::SqliteRecordStore::init_source_cache_tables(&conn)
            .expect("init source cache tables");

        let input = |source: &'static str, source_session_id: &str, session_id: &str| {
            ImportedHistoryCacheInput {
                source,
                source_session_id: source_session_id.to_string(),
                session_id: session_id.to_string(),
                source_path: "/tmp/source".to_string(),
                source_record_key: source_session_id.to_string(),
                source_mtime_ms: 1,
                source_size_bytes: 1,
                source_fingerprint: "fp".to_string(),
                parser_version: 1,
                name: "session".to_string(),
                created_at_ms: 1,
                updated_at_ms: 2,
                model: None,
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                repo_path: Some("/tmp/project".to_string()),
                branch: None,
                impact: ImportedHistoryImpactStats::default(),
                listable: true,
                source_metadata_json: None,
                parent_session_id: None,
            }
        };
        let claude_session_id = format!("claudecodeapp-{UUID}");
        crate::sources::imported_history::cache::upsert_imported_session_cache_from_conn(
            &mut conn,
            &[
                input(SOURCE_CLAUDE_CODE, UUID, &claude_session_id),
                input("opencode", "ses_123", "opencodeapp-ses_123"),
            ],
        )
        .expect("upsert");

        let (plan, session) = cli_resume_plan_for_cached_session(&conn, &claude_session_id)
            .expect("query")
            .expect("plan");
        assert_eq!(plan.native_session_id, UUID);
        assert_eq!(session.repo_path.as_deref(), Some("/tmp/project"));

        assert!(cli_resume_plan_for_cached_session(&conn, "opencodeapp-ses_123")
            .expect("query")
            .is_none());
        assert!(cli_resume_plan_for_cached_session(&conn, "unknown-id")
            .expect("query")
            .is_none());
    }
}
