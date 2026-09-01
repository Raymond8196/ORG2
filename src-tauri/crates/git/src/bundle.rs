//! Git Bundle Module
//!
//! Provides Tauri commands for creating git bundles from local repositories.
//! Used for uploading local projects to cloud market sessions while
//! preserving git history.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;

use crate::util::{close_inherited_fds, git_command, is_transient_error};

// ============================================
// Types
// ============================================

/// Result of git bundle creation
#[derive(Debug, Serialize, Deserialize)]
pub struct GitBundleResult {
    /// Base64-encoded bundle data
    pub data: String,
    /// Size of the bundle in bytes
    pub size: u64,
    /// Branch name that was bundled
    pub branch_name: String,
    /// HEAD commit SHA
    pub head_sha: String,
    /// Number of commits in the bundle
    pub commit_count: usize,
    /// Original folder name
    pub folder_name: String,
}

/// Progress information during bundle creation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleProgress {
    pub phase: String,
    pub message: String,
}

// ============================================
// Constants
// ============================================

// ============================================
// Helper Functions
// ============================================

/// Helper to run git commands directly, closing inherited file descriptors
/// Uses pre_exec on Unix to close FDs 3-1024 before exec to avoid WebView FD inheritance issues
fn run_git_command(repo_path: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    // Verify the directory exists before running
    if !repo_path.exists() {
        return Err(format!("Repository path does not exist: {:?}", repo_path));
    }

    let max_retries = 5;
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        let result = git_command().and_then(|mut cmd| {
            cmd.args(args)
                .current_dir(repo_path)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("GIT_TERMINAL_PROMPT", "0");

            close_inherited_fds(&mut cmd);
            cmd.output().map_err(|err| err.to_string())
        });

        match result {
            Ok(output) => return Ok(output),
            Err(e) => {
                last_error = e.to_string();

                // Only retry transient errors
                if !is_transient_error(&last_error) {
                    return Err(format!(
                        "Failed to run git {}: {} (path: {:?})",
                        args.join(" "),
                        last_error,
                        repo_path
                    ));
                }
            }
        }

        // Exponential backoff
        if attempt < max_retries - 1 {
            let delay_ms = 200 * (attempt as u64 + 1);
            println!(
                "⚠️ [GitBundle] Retry {}/{} for git {} (waiting {}ms) - {}",
                attempt + 1,
                max_retries,
                args.join(" "),
                delay_ms,
                last_error
            );
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
    }

    Err(format!(
        "git {} failed after {} retries: {} (path: {:?})",
        args.join(" "),
        max_retries,
        last_error,
        repo_path
    ))
}

/// Get the current branch name
fn get_current_branch(repo_path: &PathBuf) -> Result<String, String> {
    let output = run_git_command(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get the HEAD commit SHA
fn get_head_sha(repo_path: &PathBuf) -> Result<String, String> {
    let output = run_git_command(repo_path, &["rev-parse", "HEAD"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Count commits in the repository
fn count_commits(repo_path: &PathBuf) -> Result<usize, String> {
    let output = run_git_command(repo_path, &["rev-list", "--count", "HEAD"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let count_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    count_str
        .parse::<usize>()
        .map_err(|e| format!("Failed to parse commit count: {}", e))
}

/// Check if there are uncommitted changes (for get_git_repo_info)
fn has_uncommitted_changes(repo_path: &PathBuf) -> Result<bool, String> {
    let output = run_git_command(repo_path, &["status", "--porcelain"])?;

    if !output.status.success() {
        // If status fails, assume no changes (to avoid blocking the info query)
        return Ok(false);
    }

    Ok(!output.stdout.is_empty())
}

// ============================================
// Tauri Commands
// ============================================

/// Get git repository information without creating bundle
/// Useful for showing preview before bundling
#[tauri::command(rename_all = "camelCase")]
pub fn get_git_repo_info(folder_path: String) -> Result<GitRepoInfo, String> {
    let repo_path = PathBuf::from(&folder_path);

    if !repo_path.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }

    if !repo_path.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }

    // Check if it's a git repository
    let git_dir = repo_path.join(".git");
    let is_git_repo = git_dir.exists();

    let folder_name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    if !is_git_repo {
        return Ok(GitRepoInfo {
            folder_name,
            is_git_repo: false,
            branch_name: None,
            head_sha: None,
            commit_count: 0,
            has_uncommitted_changes: false,
        });
    }

    let branch_name = get_current_branch(&repo_path).ok();
    let head_sha = get_head_sha(&repo_path).ok();
    let commit_count = count_commits(&repo_path).unwrap_or(0);
    let uncommitted = has_uncommitted_changes(&repo_path).unwrap_or(false);

    Ok(GitRepoInfo {
        folder_name,
        is_git_repo: true,
        branch_name,
        head_sha,
        commit_count,
        has_uncommitted_changes: uncommitted,
    })
}

/// Git repository information
#[derive(Debug, Serialize, Deserialize)]
pub struct GitRepoInfo {
    pub folder_name: String,
    pub is_git_repo: bool,
    pub branch_name: Option<String>,
    pub head_sha: Option<String>,
    pub commit_count: usize,
    pub has_uncommitted_changes: bool,
}

// ============================================
// Tests
// ============================================

// ============================================
// Git Sync Commands (Pull/Push)
// ============================================

/// Result of applying a git bundle
#[derive(Debug, Serialize, Deserialize)]
pub struct ApplyBundleResult {
    /// Whether the operation succeeded
    pub success: bool,
    /// The ref that was created (e.g., "refs/remotes/cloud/main")
    pub ref_name: String,
    /// Any message or error
    pub message: String,
}

/// Result of creating a push bundle
#[derive(Debug, Serialize, Deserialize)]
pub struct PushBundleResult {
    /// Base64-encoded bundle data
    pub data: String,
    /// Size in bytes
    pub size: u64,
    /// HEAD commit SHA
    pub head_sha: String,
    /// Whether this is incremental or full
    pub is_incremental: bool,
}

/// Result of merge operation
#[derive(Debug, Serialize, Deserialize)]
pub struct CloudMergeResult {
    /// Whether merge succeeded
    pub success: bool,
    /// Whether there were conflicts
    pub has_conflicts: bool,
    /// Conflicting files (if any)
    pub conflicting_files: Vec<String>,
    /// Message
    pub message: String,
}

/// Response for get_repo_branches
#[derive(Debug, Serialize, Deserialize)]
pub struct GetRepoBranchesResult {
    pub branches: Vec<BranchName>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchName {
    pub name: String,
}

// ============================================
// Git Operations for Conflict Resolution
// ============================================

/// Create a commit with the given message
/// Uses run_git_command helper with retries and clean environment
#[tauri::command(rename_all = "camelCase")]
pub fn git_commit(folder_path: String, message: String) -> Result<(), String> {
    let repo_path = PathBuf::from(&folder_path);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err(format!("Invalid folder path: {}", folder_path));
    }

    let git_dir = repo_path.join(".git");
    if !git_dir.exists() {
        return Err("Not a git repository".to_string());
    }

    // Use run_git_command which has retries and uses env -i for clean environment
    let output = run_git_command(&repo_path, &["commit", "-m", &message])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Git prints "nothing to commit, working tree clean" to STDOUT and
        // exits 1; checking stderr alone turned the benign no-op into
        // `git commit failed:` with an empty message.
        if stderr.contains("nothing to commit") || stdout.contains("nothing to commit") {
            println!("📝 [GitBundle] Nothing to commit");
            return Ok(());
        }
        return Err(format!("git commit failed: {}{}", stdout, stderr));
    }

    println!("✅ [GitBundle] Commit created: {}", message);
    Ok(())
}

// ============================================
// Local Commit History
// ============================================

/// Commit info for the frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalCommitInfo {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
}

// ============================================
// Ahead/Behind Calculation (libgit2)
// ============================================

/// Result of ahead/behind calculation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehindStatus {
    /// Number of commits local is ahead of remote
    pub ahead: usize,
    /// Number of commits local is behind remote
    pub behind: usize,
    /// Whether local and remote are in sync
    pub in_sync: bool,
}

/// Calculate ahead/behind status between local HEAD and a remote SHA.
///
/// Uses libgit2's `graph_ahead_behind()` which is O(n) where n is the
/// number of commits between the two refs — much faster than the previous
/// approach of fetching commit lists and comparing in JS.
///
/// # Arguments
/// * `folder_path` - Path to the git repository
/// * `remote_head_sha` - The remote HEAD SHA to compare against
///
/// # Returns
/// * `AheadBehindStatus` with ahead, behind counts and in_sync flag
#[tauri::command(rename_all = "camelCase")]
pub fn calculate_ahead_behind(
    folder_path: String,
    remote_head_sha: String,
) -> Result<AheadBehindStatus, String> {
    use git2::{Oid, Repository};

    let repo_path = PathBuf::from(&folder_path);

    // Validate folder exists
    if !repo_path.exists() || !repo_path.is_dir() {
        return Err(format!("Invalid folder path: {}", folder_path));
    }

    let git_dir = repo_path.join(".git");
    if !git_dir.exists() {
        return Err("Not a git repository".to_string());
    }

    // Open repository using libgit2
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    // Get local HEAD commit
    let local_oid = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?
        .peel_to_commit()
        .map_err(|e| format!("Failed to get HEAD commit: {}", e))?
        .id();

    // Parse remote SHA
    let remote_oid = Oid::from_str(&remote_head_sha)
        .map_err(|e| format!("Invalid remote SHA '{}': {}", remote_head_sha, e))?;

    // Check if remote commit exists in local repo
    // If not, the repos have diverged completely or remote is ahead
    if repo.find_commit(remote_oid).is_err() {
        // Remote commit doesn't exist locally - we're behind by unknown amount
        // Fall back to counting local commits (they're all "ahead")
        let local_count = count_commits(&repo_path).unwrap_or(0);
        return Ok(AheadBehindStatus {
            ahead: local_count,
            behind: 0, // Can't determine without remote commits
            in_sync: false,
        });
    }

    // If local and remote are the same, we're in sync
    if local_oid == remote_oid {
        return Ok(AheadBehindStatus {
            ahead: 0,
            behind: 0,
            in_sync: true,
        });
    }

    // Use libgit2's graph_ahead_behind for efficient calculation
    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, remote_oid)
        .map_err(|e| format!("Failed to calculate ahead/behind: {}", e))?;

    Ok(AheadBehindStatus {
        ahead,
        behind,
        in_sync: ahead == 0 && behind == 0,
    })
}

// ============================================
// Tests
// ============================================
