//! Canonical file-resource path resolution for provenance records.
//!
//! This adapter is deliberately host-side: it resolves filesystem aliases and
//! Git worktree roots, then returns only normalized metadata to Orgtrack.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use orgtrack_core::repo_sync::paths::record_id;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedFileResource {
    pub(crate) repository_id: Option<String>,
    pub(crate) workspace_path: String,
    pub(crate) repo_relative_path: String,
    pub(crate) display_path: String,
}

pub(crate) fn resolve_file_resource(cwd: &str, file_path: &str) -> ResolvedFileResource {
    // Resolve aliases such as macOS `/tmp` -> `/private/tmp` on both sides
    // before comparing them. For create/delete events the leaf may not exist,
    // so canonicalize the longest existing prefix and reattach the tail.
    let cwd_path = canonicalize_existing_prefix(&absolute_lexical_path(Path::new(cwd), None));
    let file_path = canonicalize_existing_prefix(&absolute_lexical_path(
        Path::new(file_path),
        Some(&cwd_path),
    ));
    let workspace = git_output(&cwd_path, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .map(|path| canonicalize_existing_prefix(&absolute_lexical_path(&path, None)))
        .unwrap_or_else(|| cwd_path.clone());
    let within_workspace = file_path.strip_prefix(&workspace).ok();
    let repository_id = within_workspace.and_then(|_| {
        git_output(
            &workspace,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .filter(|common_dir| !common_dir.is_empty())
        .map(|common_dir| record_id(&["git_repository", &common_dir]))
    });
    let relative = within_workspace
        .unwrap_or(&file_path)
        .to_string_lossy()
        .trim_start_matches(['/', '\\'])
        .replace('\\', "/");
    ResolvedFileResource {
        repository_id,
        workspace_path: workspace.to_string_lossy().into_owned(),
        display_path: relative.clone(),
        repo_relative_path: relative,
    }
}

fn git_output(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn absolute_lexical_path(path: &Path, base: Option<&Path>) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

pub(crate) fn canonicalize_existing_prefix(path: &Path) -> PathBuf {
    let lexical = absolute_lexical_path(path, None);
    let mut cursor = lexical.clone();
    let mut missing_tail = Vec::new();
    loop {
        match fs::canonicalize(&cursor) {
            Ok(mut canonical) => {
                for component in missing_tail.iter().rev() {
                    canonical.push(component);
                }
                return absolute_lexical_path(&canonical, None);
            }
            Err(_) => {
                let Some(component) = cursor.file_name().map(|name| name.to_os_string()) else {
                    return lexical;
                };
                missing_tail.push(component);
                if !cursor.pop() {
                    return lexical;
                }
            }
        }
    }
}
