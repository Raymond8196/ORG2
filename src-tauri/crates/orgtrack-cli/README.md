# orgtrack — CLI

A standalone command-line tool that **loads and analyzes AI coding-assistant
sessions** across every tool `orgtrack_core` can read — Claude Code, Codex,
Cursor (CLI & IDE), Cline, OpenCode, Warp, Windsurf, Trae, Qoder, and more — and
reports token/cost analytics, without the ORGII desktop app.

It is a thin front-end: all of the loading and analysis is `orgtrack_core`'s,
reached through three entry points — the source **registry** (scan), the
**session-usage** projection (bridge), and the **usage-dashboard** /
activity-chunk loaders (analyze & replay).

## Install / build

```bash
# from src-tauri/
cargo build --release -p orgtrack_cli
# binary: <cargo target>/release/orgtrack
```

SQLite is bundled (via `rusqlite`'s `bundled` feature), so the binary is
self-contained — no system libsqlite required.

## Commands

| Command                     | What it does                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| `orgtrack sources`          | List every tool orgtrack can read (15 today)                        |
| `orgtrack scan`             | Discover sessions from disk and index them into SQLite              |
| `orgtrack list` (`ls`)      | List indexed sessions                                               |
| `orgtrack search <query>`   | Search sessions by name / repo / touched file / model               |
| `orgtrack usage` (`stats`)  | Token & cost analytics (headline + per-session + daily trend)       |
| `orgtrack show <id>`        | Print a session's conversation / activity stream                    |
| `orgtrack plugins list`     | Show discovered loader plugins (and any that failed to load)        |

### Options

| Option                | Meaning                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `--source <id>`       | Restrict to one tool (repeatable). Default: all built-ins + plugins.   |
| `--db <path>`         | SQLite index file. Default: a temp file, fresh each run.               |
| `--limit <n>`         | Max rows to display (`list`/`search`/`usage`). Default 50.             |
| `--sort <recent\|cost\|tokens>` | Sort for `usage`. Default `recent`.                          |
| `--timeout <secs>`    | Per-tool scan budget before it's skipped. Default 30.                  |
| `--no-scan`           | Skip the disk scan; read an existing `--db` index as-is.               |
| `--no-plugins`        | Ignore discovered loader plugins.                                      |
| `--format <fmt>`      | `table` (default), `json`, `md`, `csv`. Applies to `list`/`usage`/`show`. |
| `--json`              | Shorthand for `--format json` (stdout stays clean; progress → stderr). |

### Formats & export

`--format md` and `--format csv` turn any read command into an export:

```bash
orgtrack list  --format md  > sessions.md      # a browsable session index
orgtrack usage --format csv > usage.csv        # per-session tokens + cost for a spreadsheet
orgtrack show  <id> --format md > session.md   # a portable, human-readable transcript
```

## Plugins (custom loaders)

Drop a `plugin.toml` under `~/.orgtrack/plugins/<name>/` (or a dir on
`$ORGTRACK_PLUGIN_PATH`) to add a **no-code** source. Today one kind is
supported — a loader over the generic Anthropic/Claude-style JSONL reader:

```toml
[plugin]
id     = "my_agent"
label  = "My Agent"
kind   = "loader"
format = "anthropic-jsonl"

[loader]
session_prefix = "my_agent-"
roots = ["~/.my-agent/sessions"]   # ~ and ${ENV} expand; scanned recursively
```

Then `orgtrack plugins list`, `orgtrack list --source my_agent`,
`orgtrack show my_agent-<id>`. A plugin source behaves like a built-in for
`list` / `search` / `show`. See `examples/plugins/` for a template and
`docs/orgtrack-plugins-design.md` for the full design (script loaders,
processors, and custom formatters are later phases).

> **Note:** `usage` analytics are scoped to the primary buckets
> (claude / codex / cursor / org2), so long-tail built-in sources and plugin
> sources are indexed and appear in `list` / `search` / `show` but not yet in
> the default `usage` view. An all-sources usage scope is on the roadmap.

## Model

- **Loading is fresh by default.** `list` / `search` / `usage` / `show` scan the
  providers' on-disk stores every run so results reflect current state. Pass
  `--db <path>` to persist an index; subsequent scans are incremental
  (fingerprint-based), and `--no-scan` reads the persisted index without
  touching disk.
- **Scanning is best-effort per provider.** A tool you don't have installed (or
  whose store is missing/locked) is skipped with a stderr note; you get a
  partial index over the tools you *do* use. Cursor IDE and Warp re-read large
  local databases and can take several seconds — per-source progress streams to
  stderr so a scan is never mistaken for a hang.
- **A bare index is first-class.** `orgtrack_core`'s loaders and the usage
  reader guard the desktop app's own tables with `table_exists`; this CLI
  creates empty stand-ins for the three the analytics reader references
  unconditionally (`session_token_usage`, `code_sessions`, `agent_sessions`).

## Examples

```bash
orgtrack sources
orgtrack scan --db ~/.orgtrack/index.db
orgtrack list --source claude_code --limit 20
orgtrack search auth --json
orgtrack usage --sort cost --db ~/.orgtrack/index.db --no-scan
orgtrack show claude_code-<uuid> --db ~/.orgtrack/index.db --no-scan
```

## Publishing

Today the crate is `publish = false` because it depends on the (also
unpublished) `orgtrack_core`, which in turn has workspace-path dependencies
(`core_types`, `orgtrack_protocol`, `orgtrack_sync`, `app_paths`). The crate is
deliberately dependency-light (`orgtrack_core` + `core_types` + `rusqlite` +
`serde` + `serde_json` + `toml`) so that lifting it out is mechanical. The path
to an independent publish:

1. Publish `orgtrack_core`'s leaf deps, then `orgtrack_core` itself, replacing
   `path = "…"` with versioned `crates.io` deps (or vendor them behind a
   Cargo feature).
2. Flip this crate to `publish = true`, keep the `[[bin]] name = "orgtrack"`,
   and ship prebuilt binaries (the existing `.goreleaser`-style release tooling
   in the repo can cross-compile a static, CGO-free binary thanks to bundled
   SQLite).
3. The `@orgii/orgtrack` npm package (`packages/orgtrack`) can then become the
   Node distribution wrapper that downloads/execs this binary, replacing its
   current stub entrypoint.
