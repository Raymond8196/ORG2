//! Session-id ↔ file-stem mapping and Claude projects-dir discovery.

use super::*;

pub(super) fn claude_file_stem_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(file_stem) = session_id.strip_prefix(CLAUDE_CODE_SESSION_PREFIX) else {
        return Err(format!(
            "Invalid Claude Code history session id: {session_id}"
        ));
    };
    if file_stem.is_empty() {
        return Err("Claude Code history session id is missing file stem".to_string());
    }
    Ok(file_stem)
}

pub(super) fn resolve_claude_session_path(conn: &Connection, file_stem: &str) -> Result<PathBuf, String> {
    if let Some(path) =
        imported_cache::get_cached_source_path_from_conn(conn, SOURCE_CLAUDE_CODE, file_stem)?
    {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let mut files = Vec::new();
    for projects_dir in claude_projects_dirs()? {
        if projects_dir.is_dir() {
            collect_claude_session_files(&projects_dir, &mut files)?;
        }
    }
    files
        .into_iter()
        .find(|file| file.file_stem == file_stem)
        .map(|file| file.path)
        .ok_or_else(|| format!("Claude Code history file not found for session: {file_stem}"))
}

pub(super) fn claude_projects_dirs() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    let mut dirs = claude_projects_dir_candidates(&home);
    // ORGII-managed sessions run with CLAUDE_CONFIG_DIR redirected into
    // per-account (own-key) or per-session (hosted-key) profile dirs; in
    // native-transcript mode those stores are the transcript of record.
    dirs.extend(
        crate::sources::imported_history::managed_roots::profile_root_children(
            &app_paths::claude_code_cli_profile_root(),
            &["projects"],
        ),
    );
    Ok(dirs)
}

pub(super) fn claude_projects_dir_candidates(home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(home.join(".claude"));

    #[cfg(target_os = "macos")]
    {
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Claude Code"),
        );
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("claude-code"),
        );
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Claude"),
        );
    }

    #[cfg(target_os = "windows")]
    {
        roots.push(home.join("AppData").join("Roaming").join("Claude Code"));
        roots.push(home.join("AppData").join("Roaming").join("claude-code"));
        roots.push(home.join("AppData").join("Roaming").join("Claude"));
        roots.push(home.join("AppData").join("Local").join("Claude Code"));
        roots.push(home.join("AppData").join("Local").join("claude-code"));
        roots.push(home.join("AppData").join("Local").join("Claude"));
    }

    #[cfg(target_os = "linux")]
    {
        roots.push(home.join(".config").join("claude-code"));
        roots.push(home.join(".local").join("share").join("claude-code"));
    }

    let mut seen = HashSet::new();
    roots
        .into_iter()
        .filter(|root| seen.insert(root.clone()))
        .map(|root| root.join("projects"))
        .collect()
}
