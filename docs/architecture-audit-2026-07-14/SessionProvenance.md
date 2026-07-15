# Architecture Audit: Session Provenance

Scope: extracted protocol contract, canonical records, SQLite store, native
event ingestion, external hook adapters/installers, historical reconciliation,
Tauri RPC, My Station projection, and legacy credential compatibility needed
by the isolated native E2E.

| Layer                        | Area inspected                                                   | Verdict          | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Suggested change                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. Compilation               | Rust workspace packages and TypeScript boundary                  | keep with reason | `cargo check` passes; `orgtrack_protocol` 5/5 unit/boundary tests plus 1 ignored opt-in live-envelope test, `agent_cli` 16/16, `orgtrack_core` 181/181, app `orgtrack::` 10/10, and the focused legacy-vault regression test pass. One isolated rendered E2E passes against real Claude Code, Codex, and Cursor CLIs; a second OAuth-live isolated E2E passes against a real ORG2 Rust agent. Full TypeScript check remains blocked only by the pre-existing `ContextInfoButton.tsx:468` error; changed frontend files pass ESLint.                                                            | Resolve the unrelated existing TypeScript error separately.                                                        |
| 2. Dead code / deduplication | Protocol types, adapters, reconciliation, store, hooks, UI       | keep with reason | `orgtrack_protocol` is wired into hook, native-ingestion, SQLite, query, and UI paths through a single definition. Hook/native/live and historical transcript events converge on one resource interaction store. Historical parsing uses the shared normalized `ActivityChunk` extractor, durable fingerprint checkpoints, and deterministic IDs; a changed transcript replaces only prior `reconciled` facts while preserving live hook/native facts.                                                                                                                                         | None.                                                                                                              |
| 3. Naming                    | `ResourceInteraction`, `FileResource`, `Session Provenance`      | keep with reason | Names describe domain facts and avoid the narrow/ambiguous “file touches” term. The extracted types use `ResourceInteractionOutcome` and `ResourceInteractionCaptureMethod` rather than colliding with agent-core's unrelated user-interaction outcome. Vendor names exist only at adapter/install boundaries.                                                                                                                                                                                                                                                                                 | None.                                                                                                              |
| 4. Semantic overloading      | session, source, locator, actor, resource, interaction, store    | keep with reason | Canonical IDs and vendor IDs have distinct fields; actor is not treated as session; attribution precision separates fact from inference. “Original DB path” is split into read-only `SourceLocator` input and normalized `StoreLocator` output in the extraction RFC rather than overloaded as one path or copied into events.                                                                                                                                                                                                                                                                 | Implement the locator types together with the standalone collector so they are immediately live, not aspirational. |
| 5. Default branches          | Hook source parsing, tool classification, native event variants  | keep with reason | Unknown hook sources fail closed; unknown tool/event variants produce no record rather than a misleading default action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Add explicit variants when a new file-capable tool family ships.                                                   |
| 6. Cross-domain leakage      | `orgtrack_protocol`, `orgtrack-core`, `agent-cli`, app, frontend | keep with reason | The extracted protocol depends only on Serde and has no filesystem, database, Tauri, ORG2, or vendor dependency. Installer owns vendor config; app currently owns DB/spool orchestration; frontend receives a projection.                                                                                                                                                                                                                                                                                                                                                                      | Move adapters and collector only after their injected boundaries are defined.                                      |
| 7. New-developer test        | Module/file layout and documentation                             | keep with reason | Data flow, privacy, storage, customization, and upgrade rules live in `docs/session-provenance.md`; the package boundary, locator distinction, container mapping, and phased extraction live in `docs/orgtrack-protocol-rfc.md` and the protocol crate README.                                                                                                                                                                                                                                                                                                                                 | None.                                                                                                              |
| 8. Wire/serialization        | Hook JSON → filtered envelope → SQLite JSON → Zod RPC            | keep with reason | In addition to real Claude Code 2.1.207 / Codex 0.144.1 / Cursor Agent 3.2.16 payload verification, v1 now has a checked-in JSON Schema and golden fixture. Exact round-trip tests inspect serialized bytes/fields; `deny_unknown_fields` plus negative tests reject prompt, command, output, content, diff, identity, source-DB, and store-path fields. Post-extraction live conformance strictly decoded and round-tripped 10 real envelopes (Claude 5, Codex 2, Cursor 3), proved read/write coverage for all three sources, and found none of the file-content sentinels in the wire JSON. | Add captured vendor fixtures when upstreams publish stable fixture suites.                                         |
| 9. Init parity               | Main app, native runtime, hook subprocess, tests                 | keep with reason | Hook subprocesses normalize, validate, and spool but never open SQLite; desktop drain deserializes and validates before using the desktop-owned schema/store; native events use the same record/store types without a wire round-trip. The live run exercised native emission plus all three external hooks in one app lifecycle.                                                                                                                                                                                                                                                              | Standalone collector conformance must reproduce this matrix before cutover.                                        |
| 10. Resolver symmetry        | Repo/workspace/file/session/actor identity, deployment paths     | keep with reason | Hook, native, historical, and query paths use deterministic IDs and the same file-resource resolver. Reconciliation is SQL-filtered to the original and canonical repo paths and includes hidden child rows through parent-repo inheritance. Claude's bare hook `agent_id` resolves symmetrically to the history importer's `agent-{id}` child session; unresolved actors remain visible without fabricated child navigation. Phase 1 leaves current source discovery and `~/.orgii/sessions.db` resolution unchanged while specifying separate source/store locators for later extraction.    | Add injected locators as a whole-system phase, with current host defaults tested side by side.                     |

Systematic sweeps performed: canonical session-ID prefix construction across
Claude Code, Codex, and Cursor importers; vendor workspace-root/cwd fallbacks;
all native extracted file-capable event variants; all supported user-level
hook configuration files; RPC input, output, and consumer types; all old
resource-interaction type names; all current vendor-origin and Orgtrack-store
path resolvers.

## Term overloading table

| Term                | Existing meanings found                                                               | Resolution                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| interaction outcome | Agent-core response/cancel/timeout state; Orgtrack resource success/failure state     | Extracted protocol uses `ResourceInteractionOutcome`; agent-core keeps its domain-local `InteractionOutcome<T>`.                    |
| session ID          | Vendor session ID; ORG2 canonical session ID; actor/child session identity            | Separate `sourceSessionId`, `sessionId`, and `actorId` fields; parent/actor is never inferred into the canonical session ID.        |
| original DB path    | Vendor history input path; normalized Orgtrack destination path                       | Split into read-only `SourceLocator` and writable `StoreLocator`; neither is an event field.                                        |
| source path         | Transcript/SQLite file used by an importer; workspace path used to resolve a resource | Importer source locations remain deployment metadata; resource resolution uses `cwd`/workspace and file path in the event boundary. |

## Initialization parity matrix

| Entry point                          | Normalize vendor payload   | Validate v1       | Atomic spool                     | Desktop DB init/store       | Shared resource resolver |
| ------------------------------------ | -------------------------- | ----------------- | -------------------------------- | --------------------------- | ------------------------ |
| Claude/Codex/Cursor hook subprocess  | yes                        | yes               | yes                              | no                          | on desktop drain         |
| Desktop inbox drain                  | already normalized         | yes               | reads atomically published files | yes                         | yes                      |
| ORG2 native event                    | not applicable             | typed record path | no                               | yes                         | yes                      |
| Historical transcript reconciliation | normalized `ActivityChunk` | not a wire event  | no                               | yes; fingerprint checkpoint | yes                      |
| Protocol golden fixture              | not applicable             | yes               | no                               | no                          | not applicable           |

Rendered live E2E evidence before protocol extraction (2026-07-14): one
generated file produced read/write facts from native ORG2, Claude Code, Codex,
and Cursor Agent (12 raw interactions; repeated reads and the underlying Claude
provider session are preserved as separate facts). Codex and Cursor carried
stable turn IDs; My Station rendered all four sources; a real W3C pointer click
on the Cursor Session Blame row opened that captured session. The test used
production hook installation, inbox drain, SQLite storage, history RPC, and UI
projection paths without seeded provenance rows.

Post-extraction live wire evidence (2026-07-14): real local Claude Code, Codex,
and Cursor CLIs each read and edited the same isolated file through their real
tools. Their installed hooks produced 10 privacy-filtered envelopes. The
`orgtrack_protocol` live conformance test strictly deserialized every envelope,
validated v1 invariants, checked the exact field set and round-trip bytes,
required read/write actions for every source, and verified that none of the
three content sentinels leaked.

Final rendered evidence on the current code (2026-07-14): the isolated WDIO
run passed the external-platform scenario with real Claude Code, Codex, and
Cursor CLIs. Claude delegated the read/edit to a real subagent; the hook stored
exact actor attribution; historical reconciliation created the child-session
checkpoint; My Station rendered explicit subagent/confidence text; a W3C
pointer click targeted the canonical child session; `inspectChatState` observed
`chatEventCount > 0`; and the rendered chat list contained the target filename.

The independent native ORG2 row also passed in the runner's required
`oauth-live` mode with a dedicated temporary home and a real Codex-backed Rust
agent. The agent created and read the isolated target file, Orgtrack finalized
the authoritative diff, the Diff surface rendered its real sentinel, and the
file section collapsed and re-expanded. A legacy-vault compatibility fix was
needed first because retired Gemini CLI entries used `agent_type` while the
existing filter handled only `model_type`; a focused regression test now
covers both spellings without exposing or overwriting valid credentials.
