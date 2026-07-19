use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::sources::imported_history::{cache as imported_cache, metadata::SOURCE_CODEX_APP};
use crate::store::{sqlite::SqliteRecordStore, RecordStore};

use super::*;

pub(crate) fn codex_file_stem_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(file_stem) = session_id.strip_prefix(CODEX_APP_SESSION_PREFIX) else {
        return Err(format!("Invalid Codex app session id: {session_id}"));
    };
    if file_stem.is_empty() {
        return Err("Codex app session id is missing file stem".to_string());
    }
    Ok(file_stem)
}

pub(crate) fn resolve_codex_session_path(conn: &Connection, file_stem: &str) -> Result<PathBuf, String> {
    let transcript_session_id = super::canonical_session_id(file_stem);
    let store = SqliteRecordStore::new(conn);
    if let Some(path) = store
        .get_session_actor_by_transcript_session_id(SOURCE_CODEX_APP, &transcript_session_id)?
        .and_then(|actor| actor.transcript_path)
    {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    // The lifecycle record stores the stable parent thread UUID plus the
    // child's concrete transcript path. That is enough to rediscover the
    // parent's rollout even when CODEX_HOME is outside the standard roots.
    for actor in store.list_session_actors(SOURCE_CODEX_APP, &transcript_session_id)? {
        let Some(reference_path) = actor.transcript_path.as_deref() else {
            continue;
        };
        let Some(locator) = resolve_codex_transcript_for_thread_id_near_path(
            Path::new(reference_path),
            &actor.source_session_id,
        )?
        else {
            continue;
        };
        if locator.session_id == transcript_session_id && locator.source_path.is_file() {
            return Ok(locator.source_path);
        }
    }

    // Suffix form: runner bindings carry the bare thread uuid while rollout
    // stems are `rollout-<timestamp>-<thread-uuid>`.
    if let Some(path) = imported_cache::get_cached_source_path_by_suffix_from_conn(
        conn,
        SOURCE_CODEX_APP,
        file_stem,
    )? {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let mut files = Vec::new();
    for sessions_dir in codex_sessions_dirs()? {
        if sessions_dir.is_dir() {
            collect_codex_session_files(&sessions_dir, &mut files)?;
        }
    }
    let stem_matches = |stem: &str| {
        stem == file_stem
            || (stem.len() > file_stem.len() + 1
                && stem.ends_with(file_stem)
                && stem.as_bytes()[stem.len() - file_stem.len() - 1] == b'-')
    };
    files
        .into_iter()
        .filter(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(stem_matches)
        })
        // Newest rollout wins when several share a thread (resume forks).
        .max_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|meta| meta.modified())
                .ok()
        })
        .ok_or_else(|| format!("Codex app file not found for session: {file_stem}"))
}

pub(crate) fn codex_sessions_dirs() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    let mut dirs = codex_sessions_dir_candidates(&home);
    // ORGII-managed own-key Codex runs redirect CODEX_HOME into per-account
    // profile dirs; native-transcript mode reads those rollouts back here.
    // (Hosted-key Codex keeps the system CODEX_HOME and is covered above.)
    dirs.extend(
        crate::sources::imported_history::managed_roots::profile_root_children(
            &app_paths::codex_cli_profile_root(),
            &["sessions"],
        ),
    );
    Ok(dirs)
}

pub(crate) fn codex_sessions_dir_candidates(home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(home.join(".codex"));

    #[cfg(target_os = "macos")]
    {
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Codex"),
        );
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("codex"),
        );
    }

    #[cfg(target_os = "windows")]
    {
        roots.push(home.join("AppData").join("Roaming").join("Codex"));
        roots.push(home.join("AppData").join("Roaming").join("codex"));
        roots.push(home.join("AppData").join("Local").join("Codex"));
        roots.push(home.join("AppData").join("Local").join("codex"));
    }

    #[cfg(target_os = "linux")]
    {
        roots.push(home.join(".config").join("codex"));
        roots.push(home.join(".local").join("share").join("codex"));
    }

    let mut seen = HashSet::new();
    roots
        .into_iter()
        .filter(|root| seen.insert(root.clone()))
        .map(|root| root.join("sessions"))
        .collect()
}
