# Architecture Audit — Orgtrack Round Metadata

**Scope:** Issues #387 and #388: per-round resource/development metadata, whole-session edit impact, and Kanban file search.

## Completion criteria

- [x] One Orgtrack projector owns per-round read/search/write/create/delete/rename observations.
- [x] The same projector owns modified-file line stats and development artifacts (commits/PRs).
- [x] ORG2, Claude Code, Codex, Cursor, and other normalized providers enter through the same tool metadata boundary.
- [x] `session_turns` is a rebuildable ORG2 read cache, not the semantic owner.
- [x] Historical rows rebuild lazily through a versioned index; existing DBs keep working.
- [x] Session, turn, and actor/execution-thread identities are not conflated.
- [x] The chat footer renders resource observations and edit/development metadata.
- [x] Kanban file search uses the whole-session edit projection without parsing transcripts per keystroke.

## Ownership and extraction boundary

| Layer                    | Owns                                                                                        | Does not own                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `orgtrack-protocol`      | Stable action/outcome/envelope vocabulary                                                   | Provider payload parsing, SQLite, UI                                 |
| `orgtrack-core`          | Provider adapters, resource extraction, `TurnMetadataAccumulator`, Git artifact recognition | ORG2 database paths, Tauri commands, React                           |
| `session-persistence`    | Versioned `session_turns` materialized cache and lazy rebuild                               | Tool-name constants, provider-specific result parsing, Git semantics |
| app `session_provenance` | stdin/inbox/SQLite/filesystem adapters and actor lifecycle wiring                           | Round aggregation rules                                              |
| frontend                 | Validated display and navigation                                                            | Raw transcript aggregation                                           |

Moving Orgtrack to a future repository/submodule therefore requires changing Cargo dependency locations and supplying host adapters; the protocol/projector does not depend on the ORG2 app crate.

## Identity semantics

| Field        | Meaning                                     | Source                                                    |
| ------------ | ------------------------------------------- | --------------------------------------------------------- |
| `session_id` | Durable conversation/session                | Provider canonical session identity                       |
| `turn_id`    | User-message-bounded conversational round   | Latest non-synthetic user-message id                      |
| `actor_id`   | Root agent/subagent identity                | Hook lifecycle or reconciled actor mapping                |
| `thread_id`  | Provider execution thread/process dimension | Preserved on normalized events; never reused as `turn_id` |

Native ORG2 associates completed tool calls with the nearest preceding real user message in the in-memory production event store. Reconciled histories infer the same boundary from normalized `user_message` chunks. A provider thread id may identify an execution lane or subagent and is intentionally not promoted to a conversational round.

## Provider coverage

| Capture surface            | Providers                                                                                                | Projection path                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Managed hooks              | Claude Code, Codex, Cursor, Qwen Code, Factory Droid, Trae, OpenCode, Windsurf, Kimi, Antigravity, ZCode | hook adapter → privacy-safe `ResourceInteractionEnvelopeV1`                                       |
| Imported history           | Claude Code, Codex, Cursor, OpenCode, Windsurf, WorkBuddy, Trae, Cline, Warp, ZCode                      | existing provider loader → normalized `ActivityChunk` → Orgtrack resource projector               |
| Native ORG2                | Rust-agent event pipeline                                                                                | merged production tool event → Orgtrack interaction store; turn cache → `TurnMetadataAccumulator` |
| Cloud collaboration replay | Authorized ORG2 team-session event cache                                                                 | checkout-safe path remap → normalized `ActivityChunk` → Orgtrack interaction store                |

Hook-only providers gain live provenance immediately. Providers with imported-history loaders also gain lazy historical projection. Adding a future provider means implementing an adapter/loader to the normalized boundary, not adding another turn metadata implementation.

## Production call-chain trace

| Entry point       | Path                                                                                        | Result                                                         |
| ----------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Live native tool  | production event merge → nearest user-message turn → `persist_native_event_interactions`    | Canonical session/turn/actor/resource fact                     |
| External hook     | provider hook → `hook_adapter` → privacy-safe spool → bounded drain                         | Canonical live resource fact without raw content/query/output  |
| Historical round  | existing provider loader/event cache → normalized tool metadata → `TurnMetadataAccumulator` | Lazy read/search/edit/Git metadata                             |
| Cloud replay      | authorized event cache → owner/viewer checkout remap → user-message round boundary          | Exact-owner resource facts without persisting the owner's path |
| Session aggregate | `load_turn_index` → fold unique modified paths and line totals                              | Final edit impact and Kanban search input                      |
| Chat UI           | validated RPC → per-turn atom → `TurnMetadataFooter`                                        | Read/search paths, edits, commits, and PRs                     |

## Ten-layer audit

| Layer                                 | Verdict | Evidence / decision                                                                                                                                                                                                   |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation correctness            | Pass    | Workspace Rust check, targeted Rust suites, TypeScript typecheck, ESLint, Vitest, and rendered E2E are required gates.                                                                                                |
| 2. Dead code / structural duplication | Pass    | Removed host `turn_files` and `turn_git_artifacts`; moved Git recognition and the round accumulator into Orgtrack; split hook capture, interaction storage, path resolution, and historical backfill from the facade. |
| 3. Naming consistency                 | Pass    | `TurnMetadata` names the UI/cache projection; `ResourceInteraction` names protocol facts; `modifiedFiles` remains the edit-only review subset.                                                                        |
| 4. Semantic overloading               | Pass    | Session, turn, actor, and thread meanings are documented and enforced; the former `thread_id → turn_id` assignment was removed.                                                                                       |
| 5. Default branches                   | Pass    | Malformed JSON is tolerated, unknown tools are skipped, failed writes remain failed observations and do not claim a modification, and raw provider payloads are never materialized.                                   |
| 6. Cross-domain leakage               | Pass    | Provider/tool/Git semantics live in `orgtrack-core`; `session-persistence` calls one provider-neutral accumulator; filesystem/SQLite concerns remain host adapters.                                                   |
| 7. New-developer clarity              | Pass    | Module docs and the ownership/provider/identity tables identify the one extension point and why the cache is rebuildable.                                                                                             |
| 8. Wire protocol / serialization      | Pass    | Rust serde camelCase, Zod, and TS interfaces include the same resource observation fields and bounded enums.                                                                                                          |
| 9. Init parity                        | Pass    | Fresh tables and additive existing-DB upgrades include all three JSON projections; index v10 forces lazy recomputation.                                                                                               |
| 10. Resolver symmetry                 | Pass    | Live hooks, native events, and imported histories converge on Orgtrack action/outcome/path rules; provider discovery continues to reuse existing loaders.                                                             |

## Systematic sweeps

| Issue class                | Sweep                                                         | Outcome                                                                        |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Duplicate provider parsing | Searched provider loaders, hook adapters, and turn-cache code | Existing loaders/adapters are reused; no new transcript reader was introduced. |
| Duplicate round projection | Searched file/Git accumulators and host tool-name constants   | One `TurnMetadataAccumulator` remains in `orgtrack-core`.                      |
| Identity conflation        | Searched `turn_id` assignments from `thread_id`               | Native and reconciled paths now derive turns from user-message boundaries.     |
| Schema parity              | Checked create/ALTER/insert/select/Rust/Zod/TS shapes         | All include `resource_interactions_json`; v10 rebuilds historical rows lazily. |
| Localization               | Parsed every locale JSON and compared the new feature keys    | All 13 locales include read/search/failure labels.                             |

## Final verdict

No blocking architecture finding remains. Orgtrack now owns the reusable protocol and projection semantics; ORG2 owns only adapters and a disposable read cache. The remaining future extraction work is repository packaging/versioning, not a domain redesign.

## Verification

| Gate                 | Result                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Rust workspace tests | Pass: `cargo test --workspace --quiet -- --test-threads=1`                                             |
| Rust compilation     | Pass: `cargo check --workspace`                                                                        |
| Rust lint            | Pass: `cargo clippy --workspace` (pre-existing advisory warnings only)                                 |
| Frontend types       | Pass: `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck`                                          |
| Frontend lint        | Pass: `pnpm lint`                                                                                      |
| Frontend unit tests  | Pass: 444 files / 5,124 tests                                                                          |
| Rendered desktop E2E | Pass: isolated macOS Tauri/WebDriver round-metadata scenario against the real command and SQLite cache |
| Localization         | Pass: all 13 session locale JSON files parse and contain the new keys                                  |
