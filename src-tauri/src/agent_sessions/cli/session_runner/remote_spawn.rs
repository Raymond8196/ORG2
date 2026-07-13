//! Remote CLI spawn backends (§2.5-B6).
//!
//! The spawn seam in [`super::session::run_session`] routes a `Remote` exec
//! target through this trait. Today there is one implementation —
//! [`SystemSsh`], which shells out to the system `ssh` binary. The argv is
//! assembled by the pure, injection-tested [`super::ssh`] helpers; this
//! module owns the [`Command`] wrapping and the ControlMaster socket dir.
//!
//! Why a trait at all (and not a free function): a future `russh` backend
//! implements [`RemoteSpawn`] and the spawn call site is unchanged. The
//! trait is the **single** extension seam — `session.rs` never sees an
//! `ssh` string or argv, so the ssh-quoting logic stays in exactly one
//! tested place (§2.2.1, §6 risk table).
//!
//! Scope note: this trait is for *external CLI agents* spawned over SSH.
//! The built-in Rust agent's remote execution reuses the `ExecTarget` /
//! ssh-connection types but routes through agent-core's per-tool-call
//! ExecutionBackend, **not** this trait (§0 constraint 2).

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

use agent_core::foundation::exec_target::SshTarget;
use tokio::process::Command;

use super::ssh;

/// In-memory map of session_id → remote CLI pid, captured from the
/// `ORGII_RPID` marker the spawn wrapper echoes to stderr (§2.2.1). Used by
/// the explicit-remote-kill chain in [`super::lifecycle`]. Kept separate
/// from `RUNNING_SESSIONS` (which holds the tokio JoinHandle) to avoid
/// perturbing that type's many call sites.
static REMOTE_PIDS: LazyLock<std::sync::Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Record the remote CLI pid for a session (called from the stderr reader
/// when it sees the `ORGII_RPID` marker).
pub(crate) fn set_remote_pid(session_id: &str, pid: u32) {
    if let Ok(mut map) = REMOTE_PIDS.lock() {
        map.insert(session_id.to_string(), pid);
    }
}

/// Take (remove) the remote CLI pid for a session, for the kill chain.
/// Returns `None` if no marker was ever captured (e.g. the wrapper hadn't
/// echoed yet, or stderr parsing missed it) — the caller then falls back to
/// "remote state unknown" (§2.2.1).
pub(crate) fn take_remote_pid(session_id: &str) -> Option<u32> {
    REMOTE_PIDS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(session_id))
}

/// Build the local process invocation that runs a CLI agent on a remote
/// SSH host.
///
/// The returned [`Command`] must have the agent program, args, env, and
/// working directory baked into the *remote* command. The caller applies
/// stdio / process-group / retry uniformly to both local and remote
/// spawns, so the implementation does **not** set stdio here.
pub trait RemoteSpawn: Send + Sync {
    fn build(
        &self,
        ssh: &SshTarget,
        program: &str,
        args: &[String],
        env: &HashMap<String, String>,
        working_dir: &str,
    ) -> Result<Command, String>;
}

/// Resolve (and create) the ssh ControlMaster socket directory and return
/// the `ControlPath` template ssh should use (`%C` = per-connection hash).
///
/// Shared by spawn, binary-check, dir-check, and kill so they reuse one
/// authenticated connection (§2.2). The dir is forced to 0700 on unix so
/// other users can't attach to a control socket.
pub(crate) fn control_path() -> Result<String, String> {
    let dir = app_paths::ssh_control_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create ssh control dir {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(dir.join("%C").to_string_lossy().into_owned())
}

/// System `ssh` backend.
///
/// Inherits `~/.ssh/config` (ProxyJump, Include, Match, ControlMaster) for
/// free — exactly what issue #157's "reuse existing SSH mechanisms"
/// acceptance criterion requires. The argv is assembled by the pure,
/// injection-tested [`ssh::build_remote_command_argv`]; this impl filters
/// env (§2.3), resolves the control socket, and wraps it in a [`Command`].
pub struct SystemSsh;

impl RemoteSpawn for SystemSsh {
    fn build(
        &self,
        ssh_target: &SshTarget,
        program: &str,
        args: &[String],
        env: &HashMap<String, String>,
        working_dir: &str,
    ) -> Result<Command, String> {
        let filtered_env = ssh::env_for_remote(env);
        let control_path = control_path()?;
        let argv = ssh::build_remote_command_argv(
            ssh_target,
            program,
            args,
            &filtered_env,
            working_dir,
            &control_path,
        );
        let mut cmd = Command::new("ssh");
        cmd.args(argv);
        Ok(cmd)
    }
}

// ---------------------------------------------------------------------------
// Remote pre-flight checks (binary + dir). Run before spawn so a missing
// remote CLI or working directory produces a friendly error instead of a
// confusing spawn-time failure (§1, §3-Phase1, §5.3). They share the spawn
// ControlMaster socket, so they add only a cheap round-trip on an already-
// authenticated connection.
// ---------------------------------------------------------------------------

/// ssh exits 255 on its own failures (auth rejected, host unreachable,
/// unknown host). Remote check scripts (`command -v`, `test -d`) exit 0/1,
/// never 255, so 255 unambiguously means "ssh couldn't connect".
const SSH_FAILURE_EXIT: i32 = 255;

/// Run a short check script on the remote host via `ssh ... bash -lc` and
/// return its exit code. Times out after 20s so a hung ssh can't wedge the
/// session create.
async fn run_remote_script(ssh_target: &SshTarget, script: &str) -> Result<i32, String> {
    let (code, _, _) = run_remote_script_capture(ssh_target, script).await?;
    Ok(code)
}

async fn run_remote_script_capture(
    ssh_target: &SshTarget,
    script: &str,
) -> Result<(i32, String, String), String> {
    let control_path = control_path()?;
    let argv = ssh::build_remote_check_argv(ssh_target, script, &control_path);
    let mut cmd = Command::new("ssh");
    cmd.args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn ssh: {e}"))?;
    let output = tokio::time::timeout(Duration::from_secs(20), child.wait_with_output())
        .await
        .map_err(|_| format!("ssh check to {} timed out", ssh_target.host))?
        .map_err(|e| format!("ssh wait failed: {e}"))?;
    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

/// Does `bare_command` resolve on the remote host via the login-shell PATH?
/// Mirrors the local `cli_binary_resolver` login-shell fallback over SSH
/// (§3-Phase1). `Ok(true)` = found, `Ok(false)` = not installed remotely,
/// `Err` = ssh couldn't connect (host/key problem).
pub(crate) async fn remote_binary_exists(
    ssh_target: &SshTarget,
    bare_command: &str,
) -> Result<bool, String> {
    let script = format!("command -v -- {}", ssh::sh_single_quote(bare_command));
    let code = run_remote_script(ssh_target, &script).await?;
    if code == SSH_FAILURE_EXIT {
        return Err(format!(
            "ssh connection to `{}` failed — is the host reachable and key-based \
             auth (ssh-agent / ~/.ssh) set up? (BatchMode is on, so ssh will not \
             prompt for a password.)",
            ssh_target.host
        ));
    }
    Ok(code == 0)
}

/// Does `dir` exist on the remote host? Replaces the local `Path::is_dir`
/// check for remote targets (§3-Phase1). Same return convention as
/// [`remote_binary_exists`].
pub(crate) async fn remote_dir_exists(ssh_target: &SshTarget, dir: &str) -> Result<bool, String> {
    let script = format!("test -d {}", ssh::sh_single_quote(dir));
    let code = run_remote_script(ssh_target, &script).await?;
    if code == SSH_FAILURE_EXIT {
        return Err(format!(
            "ssh connection to `{}` failed — is the host reachable and key-based \
             auth (ssh-agent / ~/.ssh) set up?",
            ssh_target.host
        ));
    }
    Ok(code == 0)
}

pub(crate) async fn remote_node_major_at_least(
    ssh_target: &SshTarget,
    min_major: u32,
) -> Result<(bool, Option<String>), String> {
    let (code, stdout, stderr) =
        run_remote_script_capture(ssh_target, "node -p 'process.versions.node'").await?;
    if code == SSH_FAILURE_EXIT {
        return Err(format!(
            "ssh connection to `{}` failed while checking node",
            ssh_target.host
        ));
    }
    if code != 0 {
        tracing::warn!(
            "[remote_preflight] node version check failed host={} exit={} stderr={}",
            ssh_target.host,
            code,
            stderr
        );
        return Ok((false, None));
    }

    let major = stdout
        .split('.')
        .next()
        .and_then(|part| part.parse::<u32>().ok());
    Ok((major.is_some_and(|value| value >= min_major), Some(stdout)))
}

/// Write `content` to `path` on the remote host, creating parent dirs.
///
/// Content is piped via ssh stdin (not baked into the argv) so the skill
/// body — which can be large and arbitrarily-shaped — never goes through
/// shell quoting (§2.6-a). Reuses the ControlMaster connection. Used to
/// materialize orgii skill files on a remote workspace.
pub(crate) async fn remote_write_file(
    ssh_target: &SshTarget,
    path: &str,
    content: String,
) -> Result<(), String> {
    let parent = std::path::Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let script = if parent.is_empty() {
        format!("cat > {}", ssh::sh_single_quote(path))
    } else {
        format!(
            "mkdir -p {} && cat > {}",
            ssh::sh_single_quote(&parent),
            ssh::sh_single_quote(path)
        )
    };
    let control_path = control_path()?;
    let argv = ssh::build_remote_check_argv(ssh_target, &script, &control_path);
    let mut cmd = Command::new("ssh");
    cmd.args(&argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn ssh: {e}"))?;
    // Pipe content to ssh's stdin → the remote `cat` writes it. Dropping the
    // handle closes the pipe (EOF) so `cat` flushes and exits.
    {
        use tokio::io::AsyncWriteExt;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(content.as_bytes()).await;
        }
    }
    let output = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
        .await
        .map_err(|_| format!("ssh write to {} timed out", ssh_target.host))?
        .map_err(|e| format!("ssh wait failed: {e}"))?;
    let code = output.status.code().unwrap_or(-1);
    if code != 0 {
        return Err(format!(
            "ssh write to {} failed (exit {}): {}",
            path,
            code,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Remove a skill file from the remote host, but only if it carries the
/// orgii marker — never delete a user's own rule file. Mirrors the Local
/// `cleanup_synced_skill_files` marker check over ssh (§2.6-a).
pub(crate) async fn remote_remove_skill_file(
    ssh_target: &SshTarget,
    path: &str,
) -> Result<(), String> {
    // grep -qF marker path && rm -f path:
    //   grep matches  → file is ours → rm runs (exit 0)
    //   grep no match → file missing or not ours → rm skipped (exit 1, ok)
    let script = format!(
        "grep -qF -- {} {} && rm -f {}",
        ssh::sh_single_quote("generated by orgii"),
        ssh::sh_single_quote(path),
        ssh::sh_single_quote(path)
    );
    let code = run_remote_script(ssh_target, &script).await?;
    if code == SSH_FAILURE_EXIT {
        return Err(format!(
            "ssh connection to `{}` failed while cleaning up skill file",
            ssh_target.host
        ));
    }
    // exit 0 (removed) and exit 1 (not ours / missing) are both acceptable.
    Ok(())
}

/// Kill a remote process: SIGTERM, grace period, then SIGKILL if still
/// alive (§2.2.1). `pid` is a `u32` captured from the `ORGII_RPID` marker,
/// so it is digits-only and safe to interpolate into the remote command
/// without quoting.
///
/// Returns `Err` only if ssh itself couldn't connect (so the caller can
/// surface "remote state unknown"). A TERM/KILL that hits an already-exited
/// process is not an error.
pub(crate) async fn remote_kill(ssh_target: &SshTarget, pid: u32) -> Result<(), String> {
    // SIGTERM first (lets the CLI flush / shut down gracefully).
    let term = run_remote_script(ssh_target, &format!("kill -TERM {pid}")).await?;
    if term == SSH_FAILURE_EXIT {
        return Err(format!(
            "ssh connection to `{}` failed sending SIGTERM to remote pid {pid}",
            ssh_target.host
        ));
    }
    // Grace period, then check if it's still alive (kill -0 exits 0 if so).
    tokio::time::sleep(Duration::from_secs(3)).await;
    let alive = run_remote_script(ssh_target, &format!("kill -0 {pid}")).await?;
    if alive == SSH_FAILURE_EXIT {
        return Err(format!(
            "ssh connection to `{}` failed checking remote pid {pid}",
            ssh_target.host
        ));
    }
    if alive == 0 {
        tracing::info!(
            "[remote_spawn] remote pid {pid} on `{}` still alive after SIGTERM grace; sending SIGKILL",
            ssh_target.host
        );
        let kill = run_remote_script(ssh_target, &format!("kill -KILL {pid}")).await?;
        if kill == SSH_FAILURE_EXIT {
            return Err(format!(
                "ssh connection to `{}` failed sending SIGKILL to remote pid {pid}",
                ssh_target.host
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Connection health check (§3-Phase3). A lightweight, user-triggered ping that
// proves SSH connectivity + (optionally) the CLI binary / working directory
// exist on the remote host — *before* the user commits to creating a session.
// Reuses the spawn ControlMaster socket + the same check primitives as the
// pre-spawn guards, so it adds no new ssh code path to audit.
// ---------------------------------------------------------------------------

/// Result of a [`remote_preflight`] health check. Serialized to the frontend
/// (camelCase) so the "Test connection" button can render a precise verdict.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePreflightResult {
    /// Did ssh connect + authenticate (BatchMode)? When false, the other
    /// fields are `None`/irrelevant and `error` carries the ssh failure.
    pub connected: bool,
    /// Was the CLI binary found on the remote login-shell PATH? `None` = no
    /// binary check was requested (connectivity-only ping).
    pub binary_found: Option<bool>,
    /// Does the remote working directory exist? `None` = not checked.
    pub dir_ok: Option<bool>,
    /// Is the remote runtime compatible with the selected CLI? `None` = not checked.
    pub runtime_ok: Option<bool>,
    /// Human-readable verdict for the UI (one line).
    pub summary: String,
    /// Raw ssh error when `connected` is false.
    pub error: Option<String>,
}

/// Run a connection health check against `ssh_target` (§3-Phase3).
///
/// - `bare_command` — when `Some`, also verifies the CLI binary resolves on
///   the remote login-shell PATH (same check as the pre-spawn guard). The
///   binary check doubles as the connectivity proof. When `None`, a trivial
///   `true` script is run purely to test ssh connectivity.
/// - `dir` — when `Some` and the host is reachable, also checks the working
///   directory exists.
///
/// Returns a structured verdict; never errors — ssh failures land in
/// `connected=false` + `error` so the UI can always render something.
pub(crate) async fn remote_preflight(
    ssh_target: &SshTarget,
    bare_command: Option<&str>,
    dir: Option<&str>,
) -> RemotePreflightResult {
    let bare = bare_command.filter(|b| !b.is_empty());
    tracing::info!(
        "[remote_preflight] checking host={} bare_command={:?} dir={:?}",
        ssh_target.host,
        bare,
        dir
    );

    // 1. Connectivity (+ optional binary check in the same round-trip).
    let (connected, binary_found) = match bare {
        Some(cmd) => match remote_binary_exists(ssh_target, cmd).await {
            Ok(found) => {
                tracing::info!(
                    "[remote_preflight] binary check host={} command={} found={}",
                    ssh_target.host,
                    cmd,
                    found
                );
                (true, Some(found))
            }
            Err(e) => {
                tracing::warn!(
                    "[remote_preflight] ssh/binary check failed host={} command={}: {}",
                    ssh_target.host,
                    cmd,
                    e
                );
                return RemotePreflightResult {
                    connected: false,
                    binary_found: None,
                    dir_ok: None,
                    runtime_ok: None,
                    summary: format!("Couldn't connect to `{}` over SSH. {e}", ssh_target.host),
                    error: Some(e),
                };
            }
        },
        None => {
            // Connectivity-only ping: run `true` and inspect the ssh exit code.
            match run_remote_script(ssh_target, "true").await {
                Ok(code) => {
                    tracing::info!(
                        "[remote_preflight] connectivity check host={} exit={}",
                        ssh_target.host,
                        code
                    );
                    (code != SSH_FAILURE_EXIT, None)
                }
                Err(e) => {
                    tracing::warn!(
                        "[remote_preflight] connectivity check failed host={}: {}",
                        ssh_target.host,
                        e
                    );
                    return RemotePreflightResult {
                        connected: false,
                        binary_found: None,
                        dir_ok: None,
                        runtime_ok: None,
                        summary: format!("Couldn't connect to `{}` over SSH. {e}", ssh_target.host),
                        error: Some(e),
                    };
                }
            }
        }
    };

    let runtime_ok = if connected && matches!(bare, Some("claude")) && binary_found == Some(true) {
        match remote_node_major_at_least(ssh_target, 18).await {
            Ok((ok, version)) => {
                tracing::info!(
                    "[remote_preflight] node check host={} ok={} version={:?}",
                    ssh_target.host,
                    ok,
                    version
                );
                Some(ok)
            }
            Err(e) => {
                tracing::warn!(
                    "[remote_preflight] node check failed host={}: {}",
                    ssh_target.host,
                    e
                );
                None
            }
        }
    } else {
        None
    };

    // 2. Optional working-directory check (only meaningful once connected).
    let dir_ok = if connected {
        match dir.filter(|d| !d.is_empty()) {
            Some(d) => match remote_dir_exists(ssh_target, d).await {
                Ok(ok) => {
                    tracing::info!(
                        "[remote_preflight] dir check host={} dir={} ok={}",
                        ssh_target.host,
                        d,
                        ok
                    );
                    Some(ok)
                }
                // Connectivity was just proven; a dir-check transport error is
                // transient — report "unknown" rather than failing the whole
                // verdict.
                Err(e) => {
                    tracing::warn!(
                        "[remote_preflight] dir check failed host={} dir={}: {}",
                        ssh_target.host,
                        d,
                        e
                    );
                    None
                }
            },
            None => None,
        }
    } else {
        None
    };

    RemotePreflightResult {
        connected,
        binary_found,
        dir_ok,
        runtime_ok,
        summary: preflight_summary(
            &ssh_target.host,
            bare,
            binary_found,
            dir,
            dir_ok,
            runtime_ok,
        ),
        error: None,
    }
}

/// Pure summary builder, factored out so it can be unit-tested without I/O.
fn preflight_summary(
    host: &str,
    bare: Option<&str>,
    binary_found: Option<bool>,
    dir: Option<&str>,
    dir_ok: Option<bool>,
    runtime_ok: Option<bool>,
) -> String {
    // Connected but the requested binary is missing — surface that first; it's
    // the single most useful "you need to install it" signal.
    if bare.is_some() && !matches!(binary_found, Some(true)) {
        return format!(
            "Connected to `{host}`, but `{bare}` was not found on the remote \
             login-shell PATH — install it there (or put it on PATH) and retry.",
            bare = bare.unwrap_or("")
        );
    }

    if matches!(bare, Some("claude")) && matches!(runtime_ok, Some(false)) {
        return format!(
            "Connected to `{host}` and `claude` was found, but the remote Node.js \
             on PATH is too old for Claude Code. Install Node.js 18+ on the remote \
             login-shell PATH and retry."
        );
    }

    let mut sentences = vec![format!("Connected to `{host}` over SSH")];
    if let Some(b) = bare {
        sentences.push(format!("`{b}` found on the login-shell PATH"));
    }
    match (dir.filter(|d| !d.is_empty()), dir_ok) {
        (Some(d), Some(true)) => sentences.push(format!("working directory `{d}` exists")),
        (Some(d), Some(false)) => sentences.push(format!("working directory `{d}` does NOT exist")),
        (Some(_), None) => sentences.push("working directory check was inconclusive".to_string()),
        (None, _) => {}
    }
    sentences.join(". ")
}

#[cfg(test)]
mod preflight_tests {
    use super::preflight_summary;

    #[test]
    fn missing_binary_beats_other_signals() {
        let s = preflight_summary("host", Some("claude"), Some(false), None, None, None);
        assert!(s.contains("Connected to `host`"));
        assert!(s.contains("`claude` was not found"));
    }

    #[test]
    fn found_binary_and_dir_ok() {
        let s = preflight_summary(
            "host",
            Some("claude"),
            Some(true),
            Some("/repo"),
            Some(true),
            Some(true),
        );
        assert!(s.contains("Connected to `host`"));
        assert!(s.contains("`claude` found"));
        assert!(s.contains("`/repo` exists"));
    }

    #[test]
    fn found_binary_but_dir_missing() {
        let s = preflight_summary(
            "host",
            Some("claude"),
            Some(true),
            Some("/nope"),
            Some(false),
            Some(true),
        );
        assert!(s.contains("`/nope` does NOT exist"));
    }

    #[test]
    fn claude_node_too_old_beats_success_signals() {
        let s = preflight_summary(
            "host",
            Some("claude"),
            Some(true),
            Some("/repo"),
            Some(true),
            Some(false),
        );
        assert!(s.contains("Connected to `host`"));
        assert!(s.contains("Node.js"));
        assert!(s.contains("18+"));
    }

    #[test]
    fn connectivity_only_ping_has_no_binary_clause() {
        let s = preflight_summary("host", None, None, None, None, None);
        assert!(s.contains("Connected to `host`"));
        assert!(!s.contains("PATH"));
    }
}
