# orgtrack CLI — publishable loading & analysis surface

_2026-07-19_

## What shipped

A standalone `orgtrack` binary (`src-tauri/crates/orgtrack-cli`, bin name
`orgtrack`) that loads AI coding-assistant sessions from every tool
`orgtrack_core` can read and reports token/cost analytics — with no dependency
on the Tauri desktop app. It is the "turn orgtrack loading/analysis into a
publishable CLI" deliverable.

It rests on a new, small, reusable piece in core:

- **`orgtrack_core::sources::registry`** — the single source of truth for
  "which providers exist and how to scan one." Every provider already ships a
  `list_*_history_sessions_paginated(&mut Connection, limit, offset)` loader
  (disk discovery + incremental cache upsert + one page of normalized rows);
  the registry is the table that maps a stable `source` id to its loader, plus
  `registered_sources()` / `scan_source()` / `is_registered()`. The read-side
  twin already existed: `imported_history::load_activity_chunks_for_session`
  routes a `session_id` to the right parser. Together they are the whole
  loading pipeline, independent of any host.

The CLI is only argument parsing, orchestration, and formatting over:

1. `registry::scan_source` — load a provider into a SQLite index.
2. `session_usage::backfill_session_usage` — project cached sessions into the
   usage table the analytics reader consumes.
3. `usage_dashboard::*` and `load_activity_chunks_for_session` — analyze &
   replay.

Commands: `sources`, `scan`, `list`/`ls`, `search`, `usage`/`stats`, `show`.
See the crate README for the full surface. Verified end-to-end against the local
machine's real history (Claude Code + Codex: 289 listable sessions, 449
token-bearing sessions, ~$5.5k of estimated spend, 97.8% cache-hit rate).

## Why a Rust binary (not the TS stub)

`packages/orgtrack` already had a `bin: orgtrack` stub whose message admitted
"native orgtrack-core bindings will be attached during publish prep." The real
loading/analysis is all in the `orgtrack_core` Rust crate, so the shortest path
to a working, publishable CLI is a Rust binary that links it directly. The npm
package can later become a thin downloader/exec wrapper around the released
binary (see the crate README "Publishing" section for the extraction path).

## Roadmap

1. **FTS5 full-text search over session bodies.** Today `orgtrack search` is a
   substring match over titles / repo / touched files / model — good, but not
   content search. A `sessions_fts(name, body)` FTS5 virtual table built from
   `load_activity_chunks_for_session` output would make `orgtrack search` a real
   content search and could back an in-app search box too. UX patterns worth
   applying: fire at 2+ chars, fetch highlighted `snippet()` lazily for only the
   visible rows, cancel the prior in-flight query per keystroke, WAL + multiple
   reader connections so one broad query can't starve the UI.
2. **Markdown / neutral-schema export & portability.** We already normalize
   every provider to `ActivityChunk`; an `orgtrack export --format md` that
   writes a portable, human-readable transcript (plus a JSON neutral schema) is
   a small, high-value add and a natural repo-shareable artifact next to
   `.orgtrack/`. The stretch goal is regenerating a tool's *native* on-disk
   format from the neutral schema so a session can resume in a different agent.
   This lands naturally on the plugin **formatter** tier (see
   `orgtrack-plugins-design.md`).
3. **Stable cross-machine project identity.** Key the index by
   `sha256(normalized git remote)` with a path fallback and a git-root walk-up
   (monorepo-safe) so a shared index lines up across machines. Confirm the
   existing `repo_sync` identity already derives the same way.
4. **Cursor reader hardening.** The known-hard areas if the Cursor loaders hit
   walls: reverse-mapping Cursor's `md5(cwd)` hashed dirs from other providers'
   known cwds, DAG-sorting Cursor blob records, and reassembling VS Code
   `state.vscdb` composer/bubble rows.

### Explicit non-goals

- Cloud sync / RAG — out of scope for a local CLI. The value is breadth (15
  providers) plus token/cost analytics; lead with those.
