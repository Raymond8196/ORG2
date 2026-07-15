# Architecture Audit — Session File Metadata

**Scope:** Issues #387 and #388: per-round file/Git metadata, whole-session touched-file projection, and Kanban file search.

## Completion criteria

- [x] Per-round file paths and line additions/deletions are stored in `session_turns`.
- [x] Per-round commits and pull requests are stored beside the file metadata.
- [x] Live extraction and historical rebuild share one Git-artifact recognizer.
- [x] Historical rows rebuild lazily through a versioned index; no eager transcript migration is required.
- [x] Whole-session touched files are folded from the canonical turn rows.
- [x] Frontend RPC validation matches the Rust camelCase wire shape.
- [x] Chat metadata loads without subscribing the virtualized chat tree to one aggregate result map.
- [x] Kanban search reads materialized `touchedFiles`; it does not parse transcripts per keystroke.

## Production call-chain trace

| Entry point           | Path                                                                                                                | Result                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Live shell tool       | event pipeline → `shell_extractor` → `git::git_artifacts::parse_git_artifacts`                                      | Existing live cards retain the canonical commit/PR parser.       |
| Historical round load | `load_turn_index` → freshness/version check → raw event scan → `TurnFileAccumulator` / `TurnGitArtifactAccumulator` | Old sessions gain v9 metadata on first access.                   |
| Session aggregate     | unified session stats → `get_session_impact` → `load_turn_index` → fold unique paths and line totals                | Final touched-file metadata is derived from the same turn index. |
| Chat UI               | `loadTurnIndex` RPC → `TurnMetadataLoader` → per-turn atom → footer slot                                            | Only the affected round footer updates.                          |
| Kanban UI             | session aggregate → `useSessionImpact` → task impact → precomputed lowercase path text                              | Partial path/basename filtering is an in-memory lookup.          |

## Ten-layer audit

| Layer                                 | Verdict        | Evidence / decision                                                                                                                                                                                                      |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Compilation correctness            | Pass           | Rust target tests, TypeScript typecheck, targeted ESLint, and Vitest pass.                                                                                                                                               |
| 2. Dead code / structural duplication | Pass           | Removed the unused `TurnFilesContext`/`useTurnModifiedFiles` path and the separate live impact accumulator. The former app-local Git parser is now a thin re-export of the canonical `git` crate parser.                 |
| 3. Naming consistency                 | Pass           | UI/data terminology is `TurnMetadata`; stale production comments naming `TurnFilesFooter` were swept. DB names remain explicit (`modified_files_json`, `git_artifacts_json`).                                            |
| 4. Semantic overloading               | Pass           | “Turn” is the durable user-message window; “session impact” is its whole-session fold. Neither is used for read-only file access. “Touched files” means writes/patches/deletes only.                                     |
| 5. Default branches                   | Pass           | Unknown/malformed tools and payloads are skipped, not classified as edits or successful Git artifacts. Failed shell payloads produce no artifact.                                                                        |
| 6. Cross-domain leakage               | Pass           | Git recognition lives in the lower `git` crate; session materialization lives in `session-persistence`; the app layer only adapts and projects. Kanban never imports provider transcript loaders.                        |
| 7. New-developer clarity              | Pass           | Module docs identify the canonical index and explain `undefined` (not loaded) versus `null` (loaded/no matching turn). Test-case ledgers cover the user-visible states.                                                  |
| 8. Wire protocol / serialization      | Pass           | Rust uses serde camelCase, the Zod schema enumerates the same optional artifact fields, and malformed historical JSON degrades to an empty collection without corrupting the index. No external network payload changed. |
| 9. Init parity                        | Pass           | Fresh DB creation includes both JSON columns; existing DBs receive both `ALTER TABLE` migrations. Production and E2E both enter through `saveEvents`/`loadTurnIndex`, so E2E exercises the real rebuild path.            |
| 10. Resolver symmetry                 | Not applicable | This change adds no multi-source model/account/workspace resolver. Native and imported session impacts retain their existing source selection; only native turn materialization changed.                                 |

## Systematic sweeps

| Issue class                         | Sweep                                                                                            | Outcome                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate Git recognition           | Searched all `parse_git_artifacts` definitions/callers                                           | One implementation remains in `crates/git`; live and backfill paths call it.                                                                                               |
| Parallel session impact computation | Searched old impact tables/functions and event-pipeline calls                                    | Runtime session impact now folds versioned turns; the old event accumulator call is removed. Existing user DB tables are left untouched for non-destructive compatibility. |
| Schema parity                       | Searched every `session_turns` create/insert/select and frontend `TurnSummary` shape             | Create, migration, write, read, Rust struct, Zod schema, and TS interface include Git artifacts.                                                                           |
| Stale component naming              | Searched production source for `TurnFilesFooter`, `TurnFilesContext`, and `useTurnModifiedFiles` | No production references remain. Historical audit documents are intentionally unchanged.                                                                                   |
| Localization coverage               | Checked all locale `sessions.json` files and parsed them with `jq`                               | All 13 locales contain both feature key groups and valid JSON.                                                                                                             |

## Final verdict

No blocking architecture findings remain. The JSON columns are intentionally bounded per-turn materializations: they preserve forward-compatible artifact fields, keep the frontend read O(turns), and are invalidated by `TURN_INDEX_VERSION` when extraction semantics change.
