//! `orgtrack` — a standalone CLI over `orgtrack_core`.
//!
//! It loads AI coding-assistant sessions from every tool `orgtrack_core` knows
//! how to read (Claude Code, Codex, Cursor CLI/IDE, Cline, OpenCode, Warp,
//! Windsurf, Trae, Qoder, and more), indexes them into a local SQLite store,
//! and reports usage/cost analytics — all without the desktop app.
//!
//! The whole loading + analysis pipeline is core's, reached through three entry
//! points:
//!   1. [`registry::scan_source`] — discover + cache one provider's sessions.
//!   2. [`session_usage::backfill_session_usage`] — project cached sessions
//!      into the usage table the analytics layer reads.
//!   3. [`usage_dashboard`] / [`imported_history::load_activity_chunks_for_session`]
//!      — analyze and replay.
//!
//! This binary is only argument parsing, orchestration, and formatting.

use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

mod plugins;

use core_types::activity::ActivityChunk;
use rusqlite::Connection;

use orgtrack_core::session_usage;
use orgtrack_core::sources::anthropic_jsonl::{self, AnthropicJsonlSource};
use orgtrack_core::sources::imported_history::{
    self,
    metadata::{ImportedHistoryCacheInput, ImportedHistoryImpactStats},
    ImportedHistorySessionPage, ImportedHistorySessionRow,
};
use orgtrack_core::sources::registry;
use orgtrack_core::store::sqlite::SqliteRecordStore;
use orgtrack_core::usage_dashboard::{
    self, SessionSort, TrendBucket, UsageFilter, UsageSessionRow, UsageSummary,
};

use plugins::{ExecSpec, FormatterPlugin, LoaderImpl, LoaderPlugin, ProcessorPlugin, Stage};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Page size handed to each provider scan. The loaders sync their *entire*
/// discovered set into the cache regardless of the window, so this only bounds
/// the rows read back into memory for listing — set high enough to cover any
/// realistic local history.
const SCAN_PAGE: usize = 1_000_000;

/// Default per-provider scan budget. Most providers finish in well under a
/// second; Cursor IDE re-reads a large local DB and can take ~15s. A provider
/// that exceeds this (a locked store, a pathological file) is abandoned so one
/// bad tool never hangs the whole scan.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

const HELP: &str = "\
orgtrack — load and analyze AI coding-assistant sessions across tools

USAGE:
    orgtrack <command> [options]

COMMANDS:
    sources                 List every tool orgtrack can read
    scan                    Discover sessions from disk and index them
    list                    List indexed sessions (alias: ls, sessions)
    search <query>          Search indexed sessions by name / repo / file / model
    usage                   Token & cost analytics (alias: stats)
    show <session-id>       Print a session's conversation/activity stream
    plugins list            Show discovered loader plugins
    plugins trust <id>      Trust an exec plugin so it may run
    help                    Show this help (alias: --help, -h)
    version                 Show version (alias: --version, -V)

OPTIONS:
    --source <id>           Restrict to one tool (repeatable). Default: all.
    --db <path>             SQLite index file. Default: a temp file, fresh each run.
    --limit <n>             Max rows to display (list/search/usage). Default: 50.
    --sort <recent|cost|tokens>   Sort for `usage`. Default: recent.
    --timeout <secs>        Per-tool scan budget; a tool that exceeds it is
                            skipped. Default: 30.
    --no-scan               Skip disk scan; read an existing --db as-is.
    --no-plugins            Ignore discovered loader plugins.
    --format <fmt>          Output: table (default), json, md, csv, or a
                            formatter plugin id.
    --json                  Shorthand for --format json.

PLUGINS:
    Drop a plugin.toml under ~/.orgtrack/plugins/<name>/ (or a dir on
    $ORGTRACK_PLUGIN_PATH) to add a no-code JSONL loader. See
    docs/orgtrack-plugins-design.md.

EXAMPLES:
    orgtrack sources
    orgtrack scan --db ~/.orgtrack/index.db
    orgtrack list --source claude_code --limit 20
    orgtrack search auth --json
    orgtrack usage --sort cost --db ~/.orgtrack/index.db
    orgtrack list --format md > sessions.md
    orgtrack usage --format csv > usage.csv
    orgtrack show claude_code-4f1e... --format md > session.md
";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(err) = run(&args) {
        eprintln!("orgtrack: {err}");
        std::process::exit(1);
    }
}

/// A session row tagged with the provider it came from (the row type itself
/// carries a `category`, not the stable source id, so we track it alongside).
struct ScannedRow {
    source: String,
    row: ImportedHistorySessionRow,
}

#[derive(Default)]
struct Options {
    positionals: Vec<String>,
    sources: Vec<String>,
    db: Option<String>,
    limit: Option<usize>,
    sort: Option<String>,
    timeout: Option<u64>,
    format: Option<String>,
    no_scan: bool,
    no_plugins: bool,
    json: bool,
}

impl Options {
    fn timeout(&self) -> Duration {
        Duration::from_secs(self.timeout.unwrap_or(DEFAULT_TIMEOUT_SECS).max(1))
    }

    /// The output format. `--format` wins; `--json` is a shorthand; the default
    /// is a human table.
    fn format(&self) -> Result<Format, String> {
        match self.format.as_deref() {
            Some(name) => Format::parse(name),
            None if self.json => Ok(Format::Json),
            None => Ok(Format::Table),
        }
    }
}

/// Output renderer selected by `--format`. `table` and `json` are always
/// available; `md` / `csv` are the built-in export formats. Custom template /
/// exec formatters plug in here in a later phase.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Table,
    Json,
    Md,
    Csv,
}

impl Format {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "table" => Ok(Format::Table),
            "json" => Ok(Format::Json),
            "md" | "markdown" => Ok(Format::Md),
            "csv" => Ok(Format::Csv),
            other => Err(format!(
                "unknown --format '{other}' (expected table, json, md, or csv)"
            )),
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let Some(command) = args.first() else {
        print!("{HELP}");
        return Ok(());
    };

    match command.as_str() {
        "help" | "--help" | "-h" => {
            print!("{HELP}");
            Ok(())
        }
        "version" | "--version" | "-V" => {
            println!("orgtrack {VERSION}");
            Ok(())
        }
        other => {
            let opts = parse_options(&args[1..])?;
            let discovered = plugins::discover(!opts.no_plugins);
            validate_sources(&opts, &discovered.loaders)?;
            let loaders = &discovered.loaders;
            let processors = &discovered.processors;
            let formatters = &discovered.formatters;
            match other {
                "sources" => cmd_sources(&opts, loaders),
                "plugins" => cmd_plugins(&opts, &discovered),
                "scan" => cmd_scan(&opts, loaders),
                "list" | "ls" | "sessions" => cmd_list(&opts, None, loaders, processors, formatters),
                "search" => {
                    let query = opts.positionals.join(" ");
                    if query.trim().is_empty() {
                        return Err("search needs a query, e.g. `orgtrack search auth`".into());
                    }
                    cmd_list(&opts, Some(query), loaders, processors, formatters)
                }
                "usage" | "stats" => cmd_usage(&opts, loaders, formatters),
                "show" => cmd_show(&opts, loaders, processors, formatters),
                _ => Err(format!(
                    "unknown command '{other}'. Run `orgtrack help` for usage."
                )),
            }
        }
    }
}

fn parse_options(args: &[String]) -> Result<Options, String> {
    let mut opts = Options::default();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" => opts.json = true,
            "--no-scan" => opts.no_scan = true,
            "--no-plugins" => opts.no_plugins = true,
            "--source" => {
                opts.sources
                    .push(next_value(&mut iter, "--source")?.to_string());
            }
            "--db" => opts.db = Some(next_value(&mut iter, "--db")?.to_string()),
            "--limit" => {
                let raw = next_value(&mut iter, "--limit")?;
                opts.limit = Some(
                    raw.parse::<usize>()
                        .map_err(|_| format!("--limit expects a number, got '{raw}'"))?,
                );
            }
            "--sort" => opts.sort = Some(next_value(&mut iter, "--sort")?.to_string()),
            "--format" => opts.format = Some(next_value(&mut iter, "--format")?.to_string()),
            "--timeout" => {
                let raw = next_value(&mut iter, "--timeout")?;
                opts.timeout = Some(
                    raw.parse::<u64>()
                        .map_err(|_| format!("--timeout expects seconds, got '{raw}'"))?,
                );
            }
            flag if flag.starts_with("--") => {
                return Err(format!("unknown option '{flag}'"));
            }
            positional => opts.positionals.push(positional.to_string()),
        }
    }
    // `--source` is validated against built-ins ∪ plugins in `run`, once
    // plugins are discovered.
    Ok(opts)
}

fn next_value<'a>(
    iter: &mut std::slice::Iter<'a, String>,
    flag: &str,
) -> Result<&'a str, String> {
    iter.next()
        .map(String::as_str)
        .ok_or_else(|| format!("{flag} expects a value"))
}

// ---------------------------------------------------------------------------
// Store setup
// ---------------------------------------------------------------------------

/// Where this invocation's index lives. A `--db` path persists; otherwise a
/// per-process temp file is used and deleted on exit. We never use `:memory:`
/// so provider scans can run on worker threads with their own connections to
/// the same file (see [`scan_all`]) — the timeout guard needs that isolation.
struct DbTarget {
    path: String,
    temp: bool,
}

impl Drop for DbTarget {
    fn drop(&mut self) {
        if self.temp {
            for suffix in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{suffix}", self.path));
            }
        }
    }
}

/// Resolve the index path, creating parent dirs for a persistent `--db`.
fn db_target(opts: &Options) -> Result<DbTarget, String> {
    match &opts.db {
        Some(path) if path != ":memory:" => {
            if let Some(parent) = Path::new(path).parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)
                        .map_err(|err| format!("cannot create {}: {err}", parent.display()))?;
                }
            }
            Ok(DbTarget {
                path: path.clone(),
                temp: false,
            })
        }
        _ => {
            let path = std::env::temp_dir()
                .join(format!("orgtrack-{}.db", std::process::id()))
                .to_string_lossy()
                .into_owned();
            for suffix in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{path}{suffix}"));
            }
            Ok(DbTarget { path, temp: true })
        }
    }
}

/// Open a connection to the index with a generous busy timeout (so a worker
/// still finishing a write doesn't fail a concurrent open) and initialize
/// every table the loading and analysis paths touch. `orgtrack_core` owns its
/// own tables; the three `session_token_usage` / `code_sessions` /
/// `agent_sessions` tables are owned by the desktop app in production, so a
/// standalone index creates them empty (the analytics reader references them
/// unconditionally). All the loaders and the usage reader guard *optional* app
/// tables with `table_exists`, so an empty index is a first-class store. Every
/// statement is `IF NOT EXISTS`, so opening repeatedly (once per worker) is
/// safe.
fn open_conn(path: &str) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|err| format!("cannot open {path}: {err}"))?;
    conn.busy_timeout(Duration::from_secs(30))
        .map_err(|err| format!("set busy timeout: {err}"))?;
    // WAL so a reader (analytics) never blocks on a writer (a still-running or
    // abandoned scan worker) and vice-versa — the worker-per-provider model
    // relies on concurrent connections to the same file not deadlocking.
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    SqliteRecordStore::init_tables(&conn).map_err(|err| format!("init tables: {err}"))?;
    SqliteRecordStore::init_source_cache_tables(&conn)
        .map_err(|err| format!("init source cache tables: {err}"))?;
    init_host_compat_tables(&conn)?;
    Ok(conn)
}

/// Empty stand-ins for the desktop app's session tables so the analytics
/// reader's unconditional joins resolve against a bare index. Schema mirrors
/// the app's; only the columns the reader selects matter.
fn init_host_compat_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_token_usage (
             id                 INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id         TEXT NOT NULL,
             session_type       TEXT NOT NULL DEFAULT 'code',
             model              TEXT,
             account_id         TEXT,
             input_tokens       INTEGER NOT NULL DEFAULT 0,
             output_tokens      INTEGER NOT NULL DEFAULT 0,
             cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
             cache_write_tokens INTEGER NOT NULL DEFAULT 0,
             total_tokens       INTEGER NOT NULL DEFAULT 0,
             context_tokens     INTEGER NOT NULL DEFAULT 0,
             created_at         TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS code_sessions (
             session_id     TEXT PRIMARY KEY,
             name           TEXT,
             cli_agent_type TEXT,
             cli_session_id TEXT,
             model          TEXT,
             account_id     TEXT,
             key_source     TEXT,
             updated_at     TEXT
         );
         CREATE TABLE IF NOT EXISTS agent_sessions (
             session_id TEXT PRIMARY KEY,
             name       TEXT,
             model      TEXT,
             account_id TEXT,
             key_source TEXT,
             updated_at TEXT
         );",
    )
    .map_err(|err| format!("init host-compat tables: {err}"))
}

/// A unit of scan work, `Send` so it moves into its worker thread: a built-in
/// provider (dispatched through the core registry), a declarative JSONL plugin
/// (the generic reader), or an exec plugin (a subprocess).
enum ScanJob {
    Builtin(String),
    Jsonl(AnthropicJsonlSource),
    Exec(ExecJob),
}

/// Everything a worker needs to run one exec plugin's `scan` and ingest it.
struct ExecJob {
    source: &'static str,
    session_prefix: &'static str,
    spec: ExecSpec,
    timeout: Duration,
}

impl ScanJob {
    fn run(&self, conn: &mut Connection) -> Result<ImportedHistorySessionPage, String> {
        match self {
            ScanJob::Builtin(id) => registry::scan_source(conn, id, SCAN_PAGE, 0),
            ScanJob::Jsonl(config) => {
                anthropic_jsonl::list_sessions_paginated(config, conn, SCAN_PAGE, 0)
            }
            ScanJob::Exec(job) => run_exec_scan(conn, job),
        }
    }
}

/// Every source id in play this run: built-ins plus discovered plugins, or the
/// `--source` filter verbatim (already validated).
fn target_source_ids(opts: &Options, plugins: &[LoaderPlugin]) -> Vec<String> {
    if !opts.sources.is_empty() {
        return opts.sources.clone();
    }
    let mut ids: Vec<String> = registry::registered_sources()
        .iter()
        .map(|source| source.id.to_string())
        .collect();
    ids.extend(plugins.iter().map(|plugin| plugin.id.to_string()));
    ids
}

/// Resolve one source id to its scan job, or a human reason it is skipped
/// (unknown, or an untrusted exec plugin).
fn resolve_scan_job(
    id: &str,
    plugins: &[LoaderPlugin],
    timeout: Duration,
) -> Result<ScanJob, String> {
    if registry::is_registered(id) {
        return Ok(ScanJob::Builtin(id.to_string()));
    }
    let plugin = plugins
        .iter()
        .find(|plugin| plugin.id == id)
        .ok_or_else(|| "unknown source".to_string())?;
    match &plugin.imp {
        LoaderImpl::Jsonl(config) => Ok(ScanJob::Jsonl(config.clone())),
        LoaderImpl::Exec(spec) => {
            if !plugin.runnable() {
                return Err(format!("untrusted — run `orgtrack plugins trust {id}`"));
            }
            Ok(ScanJob::Exec(ExecJob {
                source: plugin.id,
                session_prefix: plugin.session_prefix,
                spec: spec.clone(),
                timeout,
            }))
        }
    }
}

/// Reject a `--source` that names neither a built-in nor a discovered plugin.
fn validate_sources(opts: &Options, plugins: &[LoaderPlugin]) -> Result<(), String> {
    for source in &opts.sources {
        let known =
            registry::is_registered(source) || plugins.iter().any(|plugin| plugin.id == *source);
        if !known {
            return Err(format!(
                "unknown --source '{source}'. Run `orgtrack sources` to list them."
            ));
        }
    }
    Ok(())
}

/// Scan each target provider into the index at `path`, returning every
/// discovered session tagged with its source.
///
/// Each provider runs on its own worker thread with its own connection to the
/// index file, bounded by `opts.timeout()`. A provider that errors (tool not
/// installed, store missing) is skipped; a provider that *exceeds its budget*
/// (a locked store, a pathological file) is abandoned — its thread is left to
/// die at process exit — so one bad tool never hangs the whole scan. Progress
/// streams to **stderr** so a slow provider is never mistaken for a hang, while
/// stdout/JSON stays clean.
fn scan_all(path: &str, opts: &Options, plugins: &[LoaderPlugin]) -> Vec<ScannedRow> {
    let ids = target_source_ids(opts, plugins);
    let timeout = opts.timeout();
    eprintln!(
        "Scanning {} tool(s) (per-tool budget {}s)…",
        ids.len(),
        timeout.as_secs()
    );

    let mut scanned = Vec::new();
    for source in ids {
        eprint!("  {source:<14} …");
        let job = match resolve_scan_job(&source, plugins, timeout) {
            Ok(job) => job,
            Err(reason) => {
                eprintln!("\r  {source:<14} skipped ({reason})");
                continue;
            }
        };
        // An exec plugin kills its own child at `timeout` from inside the
        // worker; give the worker a grace buffer beyond that so we always
        // collect its result (and the kill has happened) instead of abandoning
        // it mid-kill and orphaning the child process. Built-in/JSONL jobs have
        // no child, so abandoning at `timeout` only leaks a thread.
        let recv_timeout = match &job {
            ScanJob::Exec(_) => timeout + Duration::from_secs(5),
            _ => timeout,
        };
        let (tx, rx) = mpsc::channel();
        let worker_path = path.to_string();
        thread::spawn(move || {
            let result =
                open_conn(&worker_path).and_then(|mut conn| job.run(&mut conn));
            // Receiver may be gone (we timed out and moved on); ignore.
            let _ = tx.send(result);
        });

        match rx.recv_timeout(recv_timeout) {
            Ok(Ok(page)) => {
                eprintln!("\r  {:<14} {} sessions      ", source, page.sessions.len());
                for row in page.sessions {
                    scanned.push(ScannedRow {
                        source: source.clone(),
                        row,
                    });
                }
            }
            Ok(Err(err)) => eprintln!("\r  {source:<14} skipped ({err})"),
            Err(mpsc::RecvTimeoutError::Timeout) => eprintln!(
                "\r  {source:<14} timed out after {}s — skipped (try `--source {source} --timeout N`)",
                timeout.as_secs()
            ),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                eprintln!("\r  {source:<14} worker exited unexpectedly")
            }
        }
    }
    scanned
}

/// Read already-indexed sessions straight from the cache tables — the
/// `--no-scan` path — without touching any provider on disk. Covers the target
/// sources' listable rows.
fn read_cached(
    conn: &Connection,
    opts: &Options,
    plugins: &[LoaderPlugin],
) -> Result<Vec<ScannedRow>, String> {
    let mut scanned = Vec::new();
    for source in target_source_ids(opts, plugins) {
        let cached =
            imported_history::cache::query_cached_sessions_for_source_from_conn(conn, &source)?;
        for session in cached {
            scanned.push(ScannedRow {
                source: source.clone(),
                row: cached_to_row(session),
            });
        }
    }
    Ok(scanned)
}

/// Project a cache row into the shared display row. Timestamps are stored as
/// epoch-ms in the cache; impact/token fields are already denormalized there.
fn cached_to_row(
    session: imported_history::cache::ImportedHistoryCachedSession,
) -> ImportedHistorySessionRow {
    let repo_name = session
        .repo_path
        .as_deref()
        .and_then(imported_history::repo_name_from_path);
    ImportedHistorySessionRow {
        session_id: session.session_id,
        name: session.name,
        status: "completed".to_string(),
        created_at: imported_history::epoch_ms_to_iso(session.created_at_ms),
        updated_at: imported_history::epoch_ms_to_iso(session.updated_at_ms),
        category: "imported",
        read_only: true,
        model: session.model,
        total_tokens: session.input_tokens.saturating_add(session.output_tokens),
        background: false,
        is_active: false,
        storage_path: Some(session.source_path),
        repo_path: session.repo_path,
        repo_name,
        branch: session.branch,
        files_changed: session.impact.files_changed,
        lines_added: session.impact.lines_added,
        lines_removed: session.impact.lines_removed,
        touched_files: session.impact.touched_files,
        parent_session_id: session.parent_session_id,
    }
}

// ---------------------------------------------------------------------------
// Exec plugin protocol (kind = loader, format = exec)
// ---------------------------------------------------------------------------

/// Run a trusted exec plugin's `scan` verb, ingest the returned sessions into
/// the cache (same primitive the built-in loaders use), and read back a page.
fn run_exec_scan(conn: &mut Connection, job: &ExecJob) -> Result<ImportedHistorySessionPage, String> {
    let request = serde_json::json!({ "protocol": job.spec.protocol, "verb": "scan" }).to_string();
    let response = run_plugin_exec(&job.spec, &request, job.timeout)?;
    let sessions = response
        .get("sessions")
        .and_then(|value| value.as_array())
        .ok_or("plugin response missing a 'sessions' array")?;

    let mut inputs = Vec::with_capacity(sessions.len());
    let mut live_ids = Vec::with_capacity(sessions.len());
    for session in sessions {
        let input = exec_session_to_input(job, session)?;
        live_ids.push(input.source_session_id.clone());
        inputs.push(input);
    }
    imported_history::cache::sync_source_cache_from_conn(conn, job.source, live_ids, inputs)?;
    imported_history::cache::query_imported_session_page_from_conn(conn, job.source, SCAN_PAGE, 0)
}

/// Run a trusted exec plugin's `load` verb for one session → its chunks.
fn run_exec_load(
    spec: &ExecSpec,
    session_id: &str,
    session_prefix: &str,
    timeout: Duration,
) -> Result<Vec<ActivityChunk>, String> {
    let source_session_id = session_id.strip_prefix(session_prefix).unwrap_or(session_id);
    let request = serde_json::json!({
        "protocol": spec.protocol,
        "verb": "load",
        "sourceSessionId": source_session_id,
    })
    .to_string();
    let response = run_plugin_exec(spec, &request, timeout)?;
    let chunks = response
        .get("chunks")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
    serde_json::from_value(chunks).map_err(|err| format!("plugin 'chunks' were not valid: {err}"))
}

/// Spawn the plugin, feed it `request` on stdin, and return its parsed stdout
/// JSON — bounded by `timeout` (the child is killed on overrun). The
/// environment is scrubbed (only PATH/HOME pass through) and the CWD is the
/// manifest dir; the child never receives the SQLite handle.
fn run_plugin_exec(
    spec: &ExecSpec,
    request: &str,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let mut child = Command::new(&spec.exec_path)
        .current_dir(&spec.cwd)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", std::env::var_os("HOME").unwrap_or_default())
        .env("ORGTRACK_PROTOCOL", spec.protocol.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("spawn {}: {err}", spec.exec_path.display()))?;

    // Feed stdin and drain stdout/stderr from threads so a large exchange
    // can't deadlock on a full pipe buffer.
    let mut stdin = child.stdin.take().ok_or("no stdin pipe")?;
    let request_owned = request.to_string();
    let writer = thread::spawn(move || {
        let _ = stdin.write_all(request_owned.as_bytes());
        // stdin drops here, signalling EOF to the child.
    });
    let mut stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let out_reader = thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stdout.read_to_string(&mut buffer);
        buffer
    });
    let mut stderr = child.stderr.take().ok_or("no stderr pipe")?;
    let err_reader = thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("plugin timed out after {}s", timeout.as_secs()));
                }
                thread::sleep(Duration::from_millis(40));
            }
            Err(err) => return Err(format!("waiting on plugin: {err}")),
        }
    };

    let _ = writer.join();
    let stdout_text = out_reader.join().unwrap_or_default();
    let stderr_text = err_reader.join().unwrap_or_default();

    if !status.success() {
        let code = status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "signal".to_string());
        let detail = stderr_text.trim();
        return Err(if detail.is_empty() {
            format!("plugin exited with {code}")
        } else {
            format!("plugin exited with {code}: {detail}")
        });
    }
    serde_json::from_str(&stdout_text).map_err(|err| format!("plugin returned invalid JSON: {err}"))
}

/// Project one plugin session JSON object into a cache input. Missing fields
/// default sensibly; `sessionId` is derived (`prefix + sourceSessionId`).
fn exec_session_to_input(
    job: &ExecJob,
    value: &serde_json::Value,
) -> Result<ImportedHistoryCacheInput, String> {
    let source_session_id = js_str(value, "sourceSessionId")
        .ok_or("a session is missing its 'sourceSessionId'")?;
    let updated_at_ms = js_i64(value, "updatedAtMs");
    let source_path = js_str(value, "sourcePath").unwrap_or_default();
    Ok(ImportedHistoryCacheInput {
        source: job.source,
        session_id: format!("{}{}", job.session_prefix, source_session_id),
        source_session_id: source_session_id.clone(),
        source_path,
        source_record_key: source_session_id,
        source_mtime_ms: js_i64_or(value, "sourceMtimeMs", updated_at_ms),
        source_size_bytes: js_i64(value, "sourceSizeBytes"),
        source_fingerprint: js_str(value, "sourceFingerprint")
            .unwrap_or_else(|| updated_at_ms.to_string()),
        parser_version: job.spec.parser_version,
        name: js_str(value, "name").unwrap_or_default(),
        created_at_ms: js_i64(value, "createdAtMs"),
        updated_at_ms,
        model: js_str(value, "model"),
        input_tokens: js_i64(value, "inputTokens"),
        output_tokens: js_i64(value, "outputTokens"),
        cache_read_tokens: js_i64(value, "cacheReadTokens"),
        cache_write_tokens: js_i64(value, "cacheWriteTokens"),
        repo_path: js_str(value, "repoPath"),
        branch: js_str(value, "branch"),
        impact: ImportedHistoryImpactStats {
            files_changed: js_i64(value, "filesChanged"),
            lines_added: js_i64(value, "linesAdded"),
            lines_removed: js_i64(value, "linesRemoved"),
            touched_files: js_str_vec(value, "touchedFiles"),
        },
        listable: value.get("listable").and_then(|v| v.as_bool()).unwrap_or(true),
        source_metadata_json: None,
        parent_session_id: js_str(value, "parentSessionId"),
    })
}

fn js_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|field| field.as_str())
        .map(str::to_string)
        .filter(|text| !text.is_empty())
}

fn js_i64(value: &serde_json::Value, key: &str) -> i64 {
    js_i64_or(value, key, 0)
}

fn js_i64_or(value: &serde_json::Value, key: &str, default: i64) -> i64 {
    value.get(key).and_then(|field| field.as_i64()).unwrap_or(default)
}

fn js_str_vec(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|field| field.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Load a session's activity chunks, routing plugin sessions (matched by their
/// `session_prefix`) through the plugin's own loader (generic JSONL, or the
/// exec plugin's `load` verb), and everything else through core's built-in
/// provider router. `Ok(None)` = unknown id.
fn load_session_chunks(
    conn: &Connection,
    session_id: &str,
    plugins: &[LoaderPlugin],
    timeout: Duration,
) -> Result<Option<Vec<ActivityChunk>>, String> {
    if let Some(plugin) = plugins
        .iter()
        .find(|plugin| session_id.starts_with(plugin.session_prefix))
    {
        return match &plugin.imp {
            LoaderImpl::Jsonl(config) => {
                anthropic_jsonl::load_session(config, conn, session_id).map(Some)
            }
            LoaderImpl::Exec(spec) => {
                if !plugin.runnable() {
                    return Err(format!(
                        "plugin '{}' is untrusted — run `orgtrack plugins trust {}`",
                        plugin.id, plugin.id
                    ));
                }
                run_exec_load(spec, session_id, plugin.session_prefix, timeout).map(Some)
            }
        };
    }
    imported_history::load_activity_chunks_for_session(conn, session_id)
}

/// The source id a session belongs to, resolved from a plugin `session_prefix`.
/// Empty for built-in sessions (their prefixes aren't exposed) — so a
/// chunk-processor scoped to a specific built-in matches nothing; use `"*"`.
fn source_of_session(session_id: &str, plugins: &[LoaderPlugin]) -> String {
    plugins
        .iter()
        .find(|plugin| session_id.starts_with(plugin.session_prefix))
        .map(|plugin| plugin.id.to_string())
        .unwrap_or_default()
}

/// Run session-stage processors over the display rows. Each processor sees the
/// in-scope rows as JSON, and returns the reshaped set (it may drop, filter,
/// rename, or annotate). A failing or untrusted processor is a no-op with a
/// stderr note — processors never lose your data. This is a display transform;
/// it does not touch the persisted index or `usage`.
fn apply_session_processors(
    mut scanned: Vec<ScannedRow>,
    processors: &[ProcessorPlugin],
    timeout: Duration,
) -> Vec<ScannedRow> {
    for processor in processors {
        if processor.stage != Stage::Session {
            continue;
        }
        let (in_scope, mut out_scope): (Vec<ScannedRow>, Vec<ScannedRow>) = scanned
            .into_iter()
            .partition(|row| processor.applies_to(&row.source));
        if in_scope.is_empty() {
            scanned = out_scope;
            continue;
        }
        if !processor.runnable() {
            eprintln!(
                "orgtrack: processor '{}' is untrusted — skipped (run `orgtrack plugins trust {}`)",
                processor.id, processor.id
            );
            out_scope.extend(in_scope);
            scanned = out_scope;
            continue;
        }
        let json_rows: Vec<serde_json::Value> = in_scope
            .iter()
            .map(|item| {
                let mut value = serde_json::to_value(&item.row).unwrap_or(serde_json::Value::Null);
                if let Some(object) = value.as_object_mut() {
                    object.insert("source".into(), serde_json::Value::String(item.source.clone()));
                }
                value
            })
            .collect();
        let request = serde_json::json!({
            "protocol": processor.spec.protocol,
            "stage": "session",
            "sessions": json_rows,
        })
        .to_string();
        match run_plugin_exec(&processor.spec, &request, timeout) {
            Ok(response) => match response.get("sessions").and_then(|value| value.as_array()) {
                Some(rows) => {
                    for value in rows {
                        if let Some(row) = scanned_row_from_json(value) {
                            out_scope.push(row);
                        }
                    }
                }
                None => {
                    eprintln!(
                        "orgtrack: processor '{}' returned no 'sessions' — keeping originals",
                        processor.id
                    );
                    out_scope.extend(in_scope);
                }
            },
            Err(err) => {
                eprintln!(
                    "orgtrack: processor '{}' failed ({err}) — keeping originals",
                    processor.id
                );
                out_scope.extend(in_scope);
            }
        }
        scanned = out_scope;
    }
    scanned
}

/// Run chunk-stage processors over one session's chunks before rendering.
fn apply_chunk_processors(
    session_id: &str,
    source: &str,
    mut chunks: Vec<ActivityChunk>,
    processors: &[ProcessorPlugin],
    timeout: Duration,
) -> Vec<ActivityChunk> {
    for processor in processors {
        if processor.stage != Stage::Chunk || !processor.applies_to(source) {
            continue;
        }
        if !processor.runnable() {
            eprintln!(
                "orgtrack: processor '{}' is untrusted — skipped (run `orgtrack plugins trust {}`)",
                processor.id, processor.id
            );
            continue;
        }
        let request = serde_json::json!({
            "protocol": processor.spec.protocol,
            "stage": "chunk",
            "sessionId": session_id,
            "chunks": serde_json::to_value(&chunks).unwrap_or(serde_json::Value::Array(Vec::new())),
        })
        .to_string();
        match run_plugin_exec(&processor.spec, &request, timeout) {
            Ok(response) => {
                if let Some(value) = response.get("chunks") {
                    match serde_json::from_value::<Vec<ActivityChunk>>(value.clone()) {
                        Ok(parsed) => chunks = parsed,
                        Err(err) => eprintln!(
                            "orgtrack: processor '{}' returned invalid chunks ({err}) — keeping originals",
                            processor.id
                        ),
                    }
                }
            }
            Err(err) => eprintln!(
                "orgtrack: processor '{}' failed ({err}) — keeping originals",
                processor.id
            ),
        }
    }
    chunks
}

/// Rebuild a display row from a processor's JSON output (camelCase, the same
/// shape `list --json` emits). Returns `None` if it lacks a `source` +
/// `sessionId`; `category` is not round-tripped (always `imported`).
fn scanned_row_from_json(value: &serde_json::Value) -> Option<ScannedRow> {
    let source = js_str(value, "source")?;
    let session_id = js_str(value, "sessionId")?;
    let flag = |key: &str, default: bool| value.get(key).and_then(|v| v.as_bool()).unwrap_or(default);
    Some(ScannedRow {
        source,
        row: ImportedHistorySessionRow {
            session_id,
            name: js_str(value, "name").unwrap_or_default(),
            status: js_str(value, "status").unwrap_or_else(|| "completed".to_string()),
            created_at: js_str(value, "createdAt").unwrap_or_default(),
            updated_at: js_str(value, "updatedAt").unwrap_or_default(),
            category: "imported",
            read_only: flag("readOnly", true),
            model: js_str(value, "model"),
            total_tokens: js_i64(value, "totalTokens"),
            background: flag("background", false),
            is_active: flag("isActive", false),
            repo_path: js_str(value, "repoPath"),
            storage_path: js_str(value, "storagePath"),
            repo_name: js_str(value, "repoName"),
            branch: js_str(value, "branch"),
            files_changed: js_i64(value, "filesChanged"),
            lines_added: js_i64(value, "linesAdded"),
            lines_removed: js_i64(value, "linesRemoved"),
            touched_files: js_str_vec(value, "touchedFiles"),
            parent_session_id: js_str(value, "parentSessionId"),
        },
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn cmd_sources(opts: &Options, plugins: &[LoaderPlugin]) -> Result<(), String> {
    let builtins = registry::registered_sources();
    if opts.json {
        let mut json: Vec<_> = builtins
            .iter()
            .map(|source| {
                serde_json::json!({ "id": source.id, "label": source.label, "kind": "builtin" })
            })
            .collect();
        json.extend(plugins.iter().map(|plugin| {
            serde_json::json!({ "id": plugin.id, "label": plugin.label, "kind": "plugin" })
        }));
        println!("{}", to_json(&json)?);
        return Ok(());
    }
    println!("{:<14}  {:<8}  TOOL", "ID", "KIND");
    println!("{}", "-".repeat(48));
    for source in builtins {
        println!("{:<14}  {:<8}  {}", source.id, "built-in", source.label);
    }
    for plugin in plugins {
        println!("{:<14}  {:<8}  {}", plugin.id, "plugin", plugin.label);
    }
    println!(
        "\n{} tools ({} built-in, {} plugin).",
        builtins.len() + plugins.len(),
        builtins.len(),
        plugins.len()
    );
    Ok(())
}

/// `orgtrack plugins list|trust <id>` — inspect and trust plugins. `list`
/// surfaces broken manifests (with the reason) so they are visible, not silent;
/// `trust` pins an exec plugin's content hash so it may run.
fn cmd_plugins(opts: &Options, discovered: &plugins::Discovered) -> Result<(), String> {
    let subcommand = opts.positionals.first().map(String::as_str).unwrap_or("list");
    match subcommand {
        "list" => cmd_plugins_list(opts, discovered),
        "trust" => {
            let id = opts
                .positionals
                .get(1)
                .ok_or("`plugins trust` needs a plugin id, e.g. `orgtrack plugins trust my_agent`")?;
            let hash = plugins::trust(id, discovered)?;
            println!("Trusted '{id}' (sha256 {}…).", &hash[..hash.len().min(12)]);
            Ok(())
        }
        other => Err(format!(
            "unknown `plugins` subcommand '{other}' (expected list or trust)"
        )),
    }
}

fn cmd_plugins_list(opts: &Options, discovered: &plugins::Discovered) -> Result<(), String> {
    if opts.json {
        println!(
            "{}",
            to_json(&serde_json::json!({
                "loaders": discovered.loaders.iter().map(|plugin| serde_json::json!({
                    "id": plugin.id,
                    "label": plugin.label,
                    "kind": plugin.kind_label(),
                    "trust": plugin.trust.label(),
                    "sessionPrefix": plugin.session_prefix,
                    "dir": plugin.manifest_dir.to_string_lossy(),
                })).collect::<Vec<_>>(),
                "processors": discovered.processors.iter().map(|plugin| serde_json::json!({
                    "id": plugin.id,
                    "label": plugin.label,
                    "kind": format!("processor ({})", plugin.stage.as_str()),
                    "trust": plugin.trust.label(),
                    "scope": plugin.scope,
                    "dir": plugin.manifest_dir.to_string_lossy(),
                })).collect::<Vec<_>>(),
                "formatters": discovered.formatters.iter().map(|plugin| serde_json::json!({
                    "id": plugin.id,
                    "label": plugin.label,
                    "kind": "formatter (template)",
                    "dir": plugin.manifest_dir.to_string_lossy(),
                })).collect::<Vec<_>>(),
                "broken": discovered.broken.iter().map(|broken| serde_json::json!({
                    "dir": broken.dir.to_string_lossy(),
                    "error": broken.error,
                })).collect::<Vec<_>>(),
            }))?
        );
        return Ok(());
    }
    if discovered.loaders.is_empty()
        && discovered.processors.is_empty()
        && discovered.formatters.is_empty()
        && discovered.broken.is_empty()
    {
        println!("No plugins found. Drop a plugin.toml under ~/.orgtrack/plugins/<name>/");
        println!("or set $ORGTRACK_PLUGIN_PATH. See docs/orgtrack-plugins-design.md.");
        return Ok(());
    }
    for plugin in &discovered.loaders {
        println!(
            "{:<14}  {:<18}  {:<9}  prefix={:<10}  {}",
            plugin.id,
            plugin.kind_label(),
            plugin.trust.label(),
            plugin.session_prefix,
            plugin.manifest_dir.display()
        );
    }
    for plugin in &discovered.processors {
        println!(
            "{:<14}  {:<18}  {:<9}  scope={:<10}  {}",
            plugin.id,
            format!("processor ({})", plugin.stage.as_str()),
            plugin.trust.label(),
            plugin.scope.join(","),
            plugin.manifest_dir.display()
        );
    }
    for plugin in &discovered.formatters {
        println!(
            "{:<14}  {:<18}  {:<9}  {}",
            plugin.id,
            "formatter (tmpl)",
            "-",
            plugin.manifest_dir.display()
        );
    }
    for broken in &discovered.broken {
        println!("{}  INVALID  {}", broken.dir.display(), broken.error);
    }
    Ok(())
}

fn cmd_scan(opts: &Options, plugins: &[LoaderPlugin]) -> Result<(), String> {
    let target = db_target(opts)?;
    let scanned = scan_all(&target.path, opts, plugins);

    // Bridge the imported caches into the usage projection so a later `usage`
    // run against the same --db sees these sessions without rescanning. A
    // per-session recompute failure is non-fatal (and makes `backfill` return
    // Err even though it projected the rest), so report the real row count from
    // the table rather than the call's Ok/Err.
    let conn = open_conn(&target.path)?;
    if let Err(err) = session_usage::backfill_session_usage(&conn, SCAN_PAGE) {
        eprintln!("orgtrack: some sessions could not be projected ({err})");
    }
    let projected = count_usage_rows(&conn);

    if opts.json {
        println!(
            "{}",
            to_json(&serde_json::json!({
                "indexed": scanned.len(),
                "projected": projected,
                "bySource": counts_by_source(&scanned),
                "db": opts.db.clone().unwrap_or_else(|| ":memory:".into()),
            }))?
        );
        return Ok(());
    }

    println!(
        "\nIndexed {} sessions ({} with usage projected).",
        scanned.len(),
        projected
    );
    match &opts.db {
        Some(path) if path != ":memory:" => println!("Index written to {path}"),
        _ => println!("(in-memory index — pass --db <path> to persist)"),
    }
    Ok(())
}

fn cmd_list(
    opts: &Options,
    search: Option<String>,
    plugins: &[LoaderPlugin],
    processors: &[ProcessorPlugin],
    formatters: &[FormatterPlugin],
) -> Result<(), String> {
    let target = db_target(opts)?;
    let mut scanned = if opts.no_scan {
        let conn = open_conn(&target.path)?;
        read_cached(&conn, opts, plugins)?
    } else {
        scan_all(&target.path, opts, plugins)
    };

    // Session-stage processors reshape the rows before search/sort/display.
    scanned = apply_session_processors(scanned, processors, opts.timeout());

    if let Some(query) = search.as_ref().map(|q| q.to_lowercase()) {
        scanned.retain(|item| row_matches(&item.row, &query));
    }
    // Newest first.
    scanned.sort_by(|a, b| b.row.updated_at.cmp(&a.row.updated_at));

    let limit = opts.limit.unwrap_or(50);
    let shown: Vec<&ScannedRow> = scanned.iter().take(limit).collect();

    if let Some(formatter) = formatter_for(opts, formatters) {
        let context = serde_json::json!({
            "command": "list",
            "sessions": list_rows_json(&shown),
            "total": scanned.len(),
        });
        return render_template(formatter, &context);
    }
    match opts.format()? {
        Format::Json => println!("{}", to_json(&list_rows_json(&shown))?),
        Format::Md => print!("{}", render_list_md(&shown)),
        Format::Csv => print!("{}", render_list_csv(&shown)),
        Format::Table => render_list_table(&shown, scanned.len()),
    }
    Ok(())
}

/// Session rows as JSON, each tagged with its `source`.
fn list_rows_json(shown: &[&ScannedRow]) -> Vec<serde_json::Value> {
    shown
        .iter()
        .map(|item| {
            let mut value = serde_json::to_value(&item.row).unwrap_or(serde_json::Value::Null);
            if let Some(object) = value.as_object_mut() {
                object.insert("source".into(), serde_json::Value::String(item.source.clone()));
            }
            value
        })
        .collect()
}

fn render_list_table(shown: &[&ScannedRow], total: usize) {
    if shown.is_empty() {
        println!("No sessions found.");
        return;
    }
    println!(
        "{:<14}  {:<19}  {:<10}  {:>8}  {:>5}  SESSION",
        "TOOL", "UPDATED", "MODEL", "TOKENS", "FILES"
    );
    println!("{}", "-".repeat(96));
    for item in shown {
        let row = &item.row;
        println!(
            "{:<14}  {:<19}  {:<10}  {:>8}  {:>5}  {}",
            truncate(&item.source, 14),
            truncate(&row.updated_at, 19),
            truncate(row.model.as_deref().unwrap_or("-"), 10),
            row.total_tokens,
            row.files_changed,
            truncate(&session_label(row), 44),
        );
    }
    println!(
        "\n{} shown{}.",
        shown.len(),
        if total > shown.len() {
            format!(" of {total} (use --limit)")
        } else {
            String::new()
        }
    );
}

fn render_list_md(shown: &[&ScannedRow]) -> String {
    let mut out = String::from("# orgtrack sessions\n\n");
    out.push_str("| Tool | Updated | Model | Tokens | Files | Session | Repo |\n");
    out.push_str("|---|---|---|--:|--:|---|---|\n");
    for item in shown {
        let row = &item.row;
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            md_cell(&item.source),
            md_cell(&row.updated_at),
            md_cell(row.model.as_deref().unwrap_or("-")),
            row.total_tokens,
            row.files_changed,
            md_cell(&row.name),
            md_cell(row.repo_name.as_deref().unwrap_or("")),
        ));
    }
    out
}

fn render_list_csv(shown: &[&ScannedRow]) -> String {
    let mut out =
        String::from("source,updated_at,model,total_tokens,files_changed,name,repo_name,session_id\n");
    for item in shown {
        let row = &item.row;
        out.push_str(&csv_row(&[
            &item.source,
            &row.updated_at,
            row.model.as_deref().unwrap_or(""),
            &row.total_tokens.to_string(),
            &row.files_changed.to_string(),
            &row.name,
            row.repo_name.as_deref().unwrap_or(""),
            &row.session_id,
        ]));
    }
    out
}

fn cmd_usage(
    opts: &Options,
    plugins: &[LoaderPlugin],
    formatters: &[FormatterPlugin],
) -> Result<(), String> {
    let target = db_target(opts)?;
    if !opts.no_scan {
        scan_all(&target.path, opts, plugins);
    }
    let conn = open_conn(&target.path)?;
    // Non-fatal: analytics should still render on whatever is already
    // projected even if a transient lock (e.g. an abandoned scan worker)
    // interrupts the bridge.
    if let Err(err) = session_usage::backfill_session_usage(&conn, SCAN_PAGE) {
        eprintln!("orgtrack: usage projection incomplete ({err})");
    }

    // The CLI reports usage across every source it indexed — long-tail
    // built-ins and plugins included — not just the dashboard's four buckets.
    let filter = UsageFilter {
        all_sources: true,
        ..UsageFilter::default()
    };
    let sort = parse_sort(opts.sort.as_deref())?;
    let limit = opts.limit.unwrap_or(50);

    let summary = usage_dashboard::usage_summary(&conn, &filter)?;
    let sessions = usage_dashboard::usage_sessions(&conn, &filter, sort, 0, limit)?;
    // Trend series (daily) is computed for JSON consumers; the table view
    // shows the headline + per-session rows.
    let overview = usage_dashboard::usage_overview(&conn, &filter, sort, 0, limit, TrendBucket::Day)?;

    if let Some(formatter) = formatter_for(opts, formatters) {
        let context = serde_json::json!({
            "command": "usage",
            "summary": summary,
            "sessions": sessions,
            "trends": overview.trends,
        });
        return render_template(formatter, &context);
    }
    match opts.format()? {
        Format::Json => println!(
            "{}",
            to_json(&serde_json::json!({
                "summary": summary,
                "sessions": sessions,
                "trends": overview.trends,
            }))?
        ),
        Format::Md => print!("{}", render_usage_md(&summary, &sessions)),
        Format::Csv => print!("{}", render_usage_csv(&sessions)),
        Format::Table => {
            print_usage_summary(&summary);
            if sessions.is_empty() {
                println!("\nNo per-session usage rows (no token-bearing sessions found).");
                return Ok(());
            }
            println!(
                "\n{:<12}  {:<10}  {:>10}  {:>9}  SESSION",
                "SOURCE", "MODEL", "TOKENS", "COST($)"
            );
            println!("{}", "-".repeat(88));
            for row in &sessions {
                print_usage_session_row(row);
            }
        }
    }
    Ok(())
}

fn render_usage_md(summary: &UsageSummary, sessions: &[UsageSessionRow]) -> String {
    let mut out = String::from("# orgtrack usage\n\n");
    out.push_str(&format!(
        "- **sessions:** {}\n- **requests:** {}\n- **total tokens:** {}\n- **estimated cost:** ${:.2}\n- **cache hit rate:** {:.1}%\n\n",
        summary.session_count,
        summary.request_count,
        summary.real_total_tokens,
        summary.cost_usd,
        summary.cache_hit_rate * 100.0
    ));
    out.push_str("| Source | Model | Tokens | Cost ($) | Session |\n");
    out.push_str("|---|---|--:|--:|---|\n");
    for row in sessions {
        out.push_str(&format!(
            "| {} | {} | {} | {:.2} | {} |\n",
            md_cell(&row.source),
            md_cell(row.model.as_deref().unwrap_or("-")),
            row.real_total_tokens,
            row.cost_usd,
            md_cell(&row.name),
        ));
    }
    out
}

fn render_usage_csv(sessions: &[UsageSessionRow]) -> String {
    let mut out = String::from(
        "source,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,cost_usd,name,session_id\n",
    );
    for row in sessions {
        out.push_str(&csv_row(&[
            &row.source,
            row.model.as_deref().unwrap_or(""),
            &row.input_tokens.to_string(),
            &row.output_tokens.to_string(),
            &row.cache_read_tokens.to_string(),
            &row.cache_write_tokens.to_string(),
            &row.real_total_tokens.to_string(),
            &format!("{:.4}", row.cost_usd),
            &row.name,
            &row.session_id,
        ]));
    }
    out
}

fn cmd_show(
    opts: &Options,
    plugins: &[LoaderPlugin],
    processors: &[ProcessorPlugin],
    formatters: &[FormatterPlugin],
) -> Result<(), String> {
    let Some(session_id) = opts.positionals.first().cloned() else {
        return Err("show needs a session id, e.g. `orgtrack show claude_code-<uuid>`".into());
    };
    let target = db_target(opts)?;
    if !opts.no_scan {
        scan_all(&target.path, opts, plugins);
    }
    let conn = open_conn(&target.path)?;

    let chunks = load_session_chunks(&conn, &session_id, plugins, opts.timeout())?.ok_or_else(
        || format!("'{session_id}' is not a known imported session id (nothing to show)"),
    )?;
    // Chunk-stage processors reshape the conversation before rendering.
    let source = source_of_session(&session_id, plugins);
    let chunks = apply_chunk_processors(&session_id, &source, chunks, processors, opts.timeout());

    if let Some(formatter) = formatter_for(opts, formatters) {
        let context = serde_json::json!({
            "command": "show",
            "sessionId": session_id,
            "chunks": chunks,
        });
        return render_template(formatter, &context);
    }
    match opts.format()? {
        Format::Json => println!("{}", to_json(&chunks)?),
        Format::Md => print!("{}", render_show_md(&session_id, &chunks)),
        Format::Csv => print!("{}", render_show_csv(&chunks)),
        Format::Table => {
            println!("Session {session_id} — {} activity chunks\n", chunks.len());
            for chunk in &chunks {
                let label = if chunk.function.is_empty() {
                    chunk.action_type.clone()
                } else {
                    format!("{}:{}", chunk.action_type, chunk.function)
                };
                println!("[{}] {}", truncate(&chunk.created_at, 19), label);
                if let Some(text) = preview_of(&chunk.args).or_else(|| preview_of(&chunk.result)) {
                    println!("    {}", truncate(&text, 160));
                }
            }
        }
    }
    Ok(())
}

/// Portable markdown transcript of a session — the export format. Message
/// bodies render as prose; tool calls render as fenced code so a transcript
/// round-trips into any markdown viewer.
fn render_show_md(session_id: &str, chunks: &[ActivityChunk]) -> String {
    let mut out = format!("# Session {session_id}\n\n");
    for chunk in chunks {
        let role = chunk_role(chunk);
        out.push_str(&format!("**{role}** · {}\n\n", truncate(&chunk.created_at, 19)));
        let body = chunk_body(&chunk.args).or_else(|| chunk_body(&chunk.result));
        match body {
            Some(text) if chunk.action_type == "tool_call" => {
                out.push_str(&format!("```\n{}\n```\n\n", text.trim_end()))
            }
            Some(text) => out.push_str(&format!("{}\n\n", text.trim_end())),
            None => out.push_str("_(no content)_\n\n"),
        }
    }
    out
}

fn render_show_csv(chunks: &[ActivityChunk]) -> String {
    let mut out = String::from("created_at,role,action_type,function,preview\n");
    for chunk in chunks {
        let preview = preview_of(&chunk.args)
            .or_else(|| preview_of(&chunk.result))
            .unwrap_or_default();
        out.push_str(&csv_row(&[
            &chunk.created_at,
            &chunk_role(chunk),
            &chunk.action_type,
            &chunk.function,
            &preview,
        ]));
    }
    out
}

/// Human role label for a chunk: `user`, `assistant`, `assistant (thinking)`,
/// or `tool: <name>`.
fn chunk_role(chunk: &ActivityChunk) -> String {
    match chunk.action_type.as_str() {
        "raw" if chunk.function.contains("user") => "user".to_string(),
        "assistant" => "assistant".to_string(),
        "thinking" => "assistant (thinking)".to_string(),
        "tool_call" => format!("tool: {}", chunk.function),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

fn print_usage_summary(summary: &UsageSummary) {
    println!("Usage summary");
    println!("  sessions        {}", summary.session_count);
    println!("  requests        {}", summary.request_count);
    println!("  input tokens    {}", summary.input_tokens);
    println!("  output tokens   {}", summary.output_tokens);
    println!("  cache read      {}", summary.cache_read_tokens);
    println!("  cache write     {}", summary.cache_write_tokens);
    println!("  total tokens    {}", summary.real_total_tokens);
    println!("  est. cost       ${:.2}", summary.cost_usd);
    println!("  cache hit rate  {:.1}%", summary.cache_hit_rate * 100.0);
    if !summary.by_bucket.is_empty() {
        println!("  by bucket:");
        for bucket in &summary.by_bucket {
            println!(
                "    {:<10} {:>10} tok  ${:.2}",
                bucket.bucket, bucket.real_total_tokens, bucket.cost_usd
            );
        }
    }
}

fn print_usage_session_row(row: &UsageSessionRow) {
    println!(
        "{:<12}  {:<10}  {:>10}  {:>9.2}  {}",
        truncate(&row.source, 12),
        truncate(row.model.as_deref().unwrap_or("-"), 10),
        row.real_total_tokens,
        row.cost_usd,
        truncate(&row.name, 40),
    );
}

fn parse_sort(sort: Option<&str>) -> Result<SessionSort, String> {
    match sort {
        None | Some("recent") => Ok(SessionSort::Recent),
        Some("cost") => Ok(SessionSort::Cost),
        Some("tokens") => Ok(SessionSort::Tokens),
        Some(other) => Err(format!(
            "unknown --sort '{other}' (expected recent, cost, or tokens)"
        )),
    }
}

/// Actual number of projected usage rows in the index — the truthful
/// "projected" figure regardless of whether the bridge reported a per-session
/// failure.
fn count_usage_rows(conn: &Connection) -> i64 {
    conn.query_row("SELECT count(*) FROM orgtrack_core_session_usage", [], |row| {
        row.get(0)
    })
    .unwrap_or(0)
}

fn counts_by_source(scanned: &[ScannedRow]) -> Vec<(String, usize)> {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for item in scanned {
        *counts.entry(item.source.clone()).or_default() += 1;
    }
    counts.into_iter().collect()
}

fn row_matches(row: &ImportedHistorySessionRow, query: &str) -> bool {
    let mut haystacks: Vec<&str> = vec![&row.name, &row.session_id];
    if let Some(repo) = &row.repo_name {
        haystacks.push(repo);
    }
    if let Some(path) = &row.repo_path {
        haystacks.push(path);
    }
    if let Some(model) = &row.model {
        haystacks.push(model);
    }
    for file in &row.touched_files {
        haystacks.push(file);
    }
    haystacks
        .iter()
        .any(|value| value.to_lowercase().contains(query))
}

fn session_label(row: &ImportedHistorySessionRow) -> String {
    let name = if row.name.trim().is_empty() {
        row.session_id.clone()
    } else {
        row.name.clone()
    };
    match &row.repo_name {
        Some(repo) if !repo.is_empty() => format!("{name}  ({repo})"),
        _ => name,
    }
}

/// Extract a chunk payload's text, newlines preserved. Activity chunks carry
/// message text under a handful of shapes — `result.message.content` for user
/// turns, `result.content` for assistant/thinking, `args.cmd`/`args.command`
/// for shell tools, `result.observation` for tool output — so probe the known
/// text-bearing keys most-specific-first, and treat an empty object as "no text
/// here" so callers fall through to the other payload.
fn extract_text(value: &serde_json::Value) -> Option<String> {
    let non_blank = |text: &str| -> Option<String> {
        if text.trim().is_empty() {
            None
        } else {
            Some(text.to_string())
        }
    };
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => non_blank(text),
        serde_json::Value::Object(map) if map.is_empty() => None,
        serde_json::Value::Array(items) if items.is_empty() => None,
        serde_json::Value::Object(map) => {
            if let Some(text) = map
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
            {
                if let Some(found) = non_blank(text) {
                    return Some(found);
                }
            }
            for key in [
                "content",
                "text",
                "observation",
                "cmd",
                "command",
                "body",
                "summary",
                "prompt",
                "description",
            ] {
                if let Some(text) = map.get(key).and_then(|value| value.as_str()) {
                    if let Some(found) = non_blank(text) {
                        return Some(found);
                    }
                }
            }
            non_blank(&value.to_string())
        }
        other => non_blank(&other.to_string()),
    }
}

/// One-line preview (newlines collapsed) — for tables and CSV cells.
fn preview_of(value: &serde_json::Value) -> Option<String> {
    extract_text(value).and_then(|text| {
        let one_line = text.replace('\n', " ");
        let trimmed = one_line.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Full multi-line body — for the markdown transcript.
fn chunk_body(value: &serde_json::Value) -> Option<String> {
    extract_text(value).map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

/// Escape a markdown table cell: no pipes or newlines may leak into the row.
fn md_cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

/// One RFC-4180-ish CSV row (trailing newline). Fields containing a comma,
/// quote, or newline are quoted with `"` doubled.
fn csv_row(fields: &[&str]) -> String {
    let escaped: Vec<String> = fields
        .iter()
        .map(|field| {
            if field.contains([',', '"', '\n', '\r']) {
                format!("\"{}\"", field.replace('"', "\"\""))
            } else {
                field.to_string()
            }
        })
        .collect();
    format!("{}\n", escaped.join(","))
}

fn truncate(value: &str, max: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= max {
        value.to_string()
    } else if max <= 1 {
        chars.into_iter().take(max).collect()
    } else {
        let head: String = chars.into_iter().take(max - 1).collect();
        format!("{head}…")
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|err| format!("json encode: {err}"))
}

/// If `--format` names a discovered formatter plugin, return it. Checked before
/// the built-in format parser so a plugin id doesn't read as "unknown format".
fn formatter_for<'a>(
    opts: &Options,
    formatters: &'a [FormatterPlugin],
) -> Option<&'a FormatterPlugin> {
    let name = opts.format.as_deref()?;
    formatters.iter().find(|formatter| formatter.id == name)
}

/// Render a command's result JSON through a formatter's sandboxed template and
/// print it. The template runs no code and gets no fs/network access.
fn render_template(
    formatter: &FormatterPlugin,
    context: &serde_json::Value,
) -> Result<(), String> {
    let source = std::fs::read_to_string(&formatter.template_path)
        .map_err(|err| format!("read template {}: {err}", formatter.template_path.display()))?;
    let mut env = minijinja::Environment::new();
    env.add_template_owned("formatter", source)
        .map_err(|err| format!("template '{}' error: {err}", formatter.id))?;
    let template = env
        .get_template("formatter")
        .map_err(|err| format!("template '{}' error: {err}", formatter.id))?;
    let rendered = template
        .render(context)
        .map_err(|err| format!("formatter '{}' render error: {err}", formatter.id))?;
    print!("{rendered}");
    if !rendered.ends_with('\n') {
        println!();
    }
    Ok(())
}
