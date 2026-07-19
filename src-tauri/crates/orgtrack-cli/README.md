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
`$ORGTRACK_PLUGIN_PATH`) to add a source. A plugin behaves like a built-in for
`list` / `search` / `show`. Two loader kinds:

**Declarative (no code)** — over the generic Anthropic/Claude-style JSONL
reader. Reads files only, so no trust needed:

```toml
[plugin]
id = "my_agent"; label = "My Agent"; kind = "loader"; format = "anthropic-jsonl"
[loader]
session_prefix = "my_agent-"
roots = ["~/.my-agent/sessions"]   # ~ and ${ENV} expand; scanned recursively
```

**Exec (a script, any language)** — an executable speaking the plugin JSON
protocol over stdin/stdout (`scan` → sessions, `load` → chunks). Because it runs
code it is **inert until trusted**:

```toml
[plugin]
id = "my_agent"; kind = "loader"; format = "exec"; exec = "./scan.py"; protocol = 1
[loader]
session_prefix = "my_agent-"
```

```bash
orgtrack plugins list               # shows it as UNTRUSTED
orgtrack plugins trust my_agent     # pins a sha256 of manifest + exec
orgtrack list --source my_agent     # now it runs
orgtrack show my_agent-<id>
```

Trust re-arms automatically if the manifest or executable changes (stored in
`~/.orgtrack/trust.json`). Exec plugins run with a scrubbed env (only
PATH/HOME), CWD = the manifest dir, never receive the database handle, and are
killed if they exceed `--timeout`. See `examples/plugins/` for templates
(including a reference `scan.py`) and `docs/orgtrack-plugins-design.md` for the
full protocol. Project-scoped plugins (`./.orgtrack/plugins`) are intentionally
not auto-loaded.

### Processors (transform / enrich / redact)

A `kind = "processor"` plugin (exec, trusted) transforms the **read/display**
path — it never changes the persisted index. Two stages:

```toml
[plugin]
id = "redact-secrets"; kind = "processor"; format = "exec"; exec = "./redact.py"
[processor]
stage = "chunk"        # "session" reshapes list/search rows; "chunk" reshapes a show
scope = ["*"]          # source ids, or "*" for all
```

- **`session`** runs over `list` / `search` rows before display — drop, rename,
  or annotate sessions (e.g. tag by branch).
- **`chunk`** runs over a `show`'s chunks — redact secrets, enrich, or filter
  the conversation.

Processors chain in discovery order; a failing or untrusted one is a no-op that
keeps your data. A chunk processor scoped to a specific *built-in* source won't
match (built-in prefixes aren't exposed) — use `"*"`. See
`examples/plugins/processor/` for a reference redactor.

### Custom formats (formatter plugins)

A `kind = "formatter"` plugin renders a command's result through a sandboxed
[minijinja](https://docs.rs/minijinja) template — no-code custom output (HTML,
text, a bespoke markdown). Templates run no code and get no fs/network access,
so **no trust** is required.

```toml
[plugin]
id = "sessions_html"; kind = "formatter"; format = "template"
[formatter]
template = "sessions.html.j2"
```

```bash
orgtrack list --format sessions_html > sessions.html
```

The template context matches `--format json` per command: `list`/`search` →
`{ command, sessions[], total }`, `usage` → `{ summary, sessions[], trends[] }`,
`show` → `{ sessionId, chunks[] }`. See `examples/plugins/formatter/` for a
reference template.

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
`serde` + `serde_json` + `toml` + `sha2` + `minijinja`) so that lifting it out
is mechanical. The path to an independent publish:

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
