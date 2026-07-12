# Architecture Audit — agent-core strict-schema nullable optional fields

**Date:** 2026-07-11
**Auditor:** orgii session
**Skill:** `.orgii/skills/architecture-audit/SKILL.md`
**Scope (changed files):**

- `src-tauri/crates/agent-core/src/core/providers/responses_common/types.rs`
- `src-tauri/crates/agent-core/src/core/tools/registry.rs`
- `src-tauri/crates/agent-core/src/core/tools/impls/coding/code_search.rs`
- `src-tauri/crates/agent-core/src/core/tools/impls/coding/manage_todo.rs`
- `src-tauri/crates/agent-core/src/core/tools/tests/registry_tests.rs`
- `src-tauri/crates/agent-core/src/core/tools/tests/search_tool_tests.rs`

## What the change does (one theme)

All six files implement a **single coherent feature**: correct handling of
optional tool-schema fields under the OpenAI **Responses API `strict: true`**
contract.

The Responses strict contract requires every property to be listed in `required`
and to appear in the model's output. Previously, source-schema _optional_ fields
either broke strict validation or were dropped. The change threads one invariant
end-to-end:

1. **Outbound schema (wire, `types.rs`):** `enforce_strict_schema` now, for every
   property **not** in the source `required` set, calls the new
   `make_schema_nullable` to rewrite it as `anyOf: [<original>, {type: null}]`,
   then marks all properties required. Optional → "required but nullable".
2. **Inbound params (`registry.rs`):** `ToolRegistry::execute` now runs the new
   `strip_optional_null_placeholders` over the model's arguments before invoking
   the tool. For properties that were originally optional and are **not**
   natively nullable, a literal `null` is deleted, restoring the "field omitted"
   shape the tools expect. Recurses into nested objects and array items.
3. **Tool-level defense (`code_search.rs`, `manage_todo.rs`):** the individual
   tools also treat `null` as "absent" (`optional_string_array`,
   `has_explicit_repo_scope`, `todo_update_from_params`), and `manage_todo` now
   rejects **empty** `content` so a provider-generated placeholder cannot silently
   erase a visible task title.
4. **Tests:** unit tests for `make_schema_nullable` behavior (`types.rs`),
   `strip_optional_null_placeholders` (`registry_tests.rs`), null-placeholder →
   default-repo behavior (`search_tool_tests.rs`), and nullable/empty todo
   patches (`manage_todo.rs`).

## Layers covered

| Layer                             | Covered           | Verdict                                                                                                                                                                                         |
| --------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Compilation correctness       | yes               | Deferred to quality gate (`cargo check` / `cargo test -p agent-core`).                                                                                                                          |
| 2 — Dead code & dedup             | yes               | One minor duplication flagged (see below).                                                                                                                                                      |
| 3 — Naming consistency            | yes               | Clean.                                                                                                                                                                                          |
| 4 — Semantic overloading          | yes               | `required`/`nullable`/`optional` used consistently.                                                                                                                                             |
| 5 — Default branch analysis       | yes               | `_ => false` branches are correct.                                                                                                                                                              |
| 8 — Wire protocol & serialization | yes (**primary**) | Round-trip parity holds; see analysis.                                                                                                                                                          |
| 9 — Init/entry-point parity       | yes               | Production funnels through `ToolRegistry::execute`; one debug bypass noted.                                                                                                                     |
| 6, 7, 10                          | partially / n/a   | Layer 6 (cross-domain leakage) n/a — code is generic schema plumbing; Layer 7 (new-dev clarity) good — doc comments explain intent; Layer 10 (resolver symmetry) n/a — no multi-field resolver. |

## Layer 8 — Wire Protocol & Serialization (primary)

This is exactly the layer this change lives in: it alters the JSON schema sent to
the provider and the JSON params received back.

**Round-trip parity invariant (verified by reading both sides):**

- The outbound transform (`make_schema_nullable`) makes a field nullable **iff**
  it is not in the source `required` set.
- The inbound strip (`strip_optional_null_placeholders`) deletes a `null` **iff**
  the field is not in the source `required` set **and** the property schema does
  not natively accept null.
- Both sides key off the **same source `required` set**, so the set of fields
  that can carry a `null` placeholder outbound is exactly the set stripped
  inbound. This symmetry is the correctness core — documented here so a future
  edit to one side without the other is caught.

**Critical detail — the strip reads the pre-strict schema.** `registry.rs:381`
passes `&tool.parameters()` (the original, non-strict schema) to the strip, not
the `enforce_strict_schema`-mutated copy. That is correct: `enforce_strict_schema`
is applied on a _clone_ at the provider boundary (`converter.rs:266`), never
mutating `tool.parameters()`. So `originally_required` inside the strip genuinely
reflects the source optionality. **Fragility note:** if someone ever makes
`enforce_strict_schema` mutate the registered schema in place, the strip's
`originally_required` would become the strict (all-required) set and it would stop
stripping. Worth a comment at the call site; flagged, not fixed (audit-only PR).

**Explicitly-nullable fields are preserved:** `strip_optional_null_placeholders`
uses `schema_accepts_null` so a field whose source schema is `anyOf:[T, null]`
keeps its `null` value (the test `strict_schema_null_placeholders_restore_optional_omissions`
asserts `explicit_null` survives while `repo_paths` is dropped). Good — "omitted"
and "intentionally null" stay distinct.

**Provider-agnostic strip:** the strip runs in `ToolRegistry::execute` for all
providers, but only strict Responses/Codex providers generate the null
placeholders. For non-strict providers there are no such placeholders, so the
strip is a no-op in practice (and harmless if a model ever emitted a stray null
for an optional non-nullable field). Acceptable.

## Layer 9 — Entry-Point Parity

Tool execution entry points:

| Entry point                                                              | Applies `strip_optional_null_placeholders`? | Verdict                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ToolRegistry::execute` (production)                                     | yes (`registry.rs:381`)                     | correct                                                                                                                        |
| `ToolRegistry::execute_action` → `self.execute`                          | yes (delegates)                             | correct                                                                                                                        |
| `state/commands/session/debug/org_runtime.rs` direct `tool.execute(...)` | no (bypasses registry)                      | acceptable — debug endpoint constructs params in-code, not from a model, so no null placeholders arise. Flagged for awareness. |
| test helpers calling `tool.execute(...)` directly                        | no                                          | expected — tests exercise tool logic directly.                                                                                 |

No production path constructs tool params from a model response and bypasses the
registry strip. Parity holds for the model-driven path.

## Layer 2 — Dead Code & Duplication

- `make_schema_nullable` (types.rs) contains an `already_nullable` check that is
  logically identical to `schema_accepts_null` (registry.rs): both answer "does
  this schema permit `null`?" by inspecting `type` (string/array) and
  `anyOf`/`oneOf` variants.
  **Verdict: keep with reason (low-priority dedup candidate).** The two live in
  different modules (`providers::responses_common` vs `tools`) with no existing
  shared util between them; extracting a helper would create a new cross-module
  dependency for ~10 lines. Note it so the next pass can promote it if a third
  copy appears.
- `todo_update_from_params` extraction (manage_todo.rs) **removes** duplication —
  it consolidates the inline `TodoUpdate` construction and makes it unit-testable.
  Positive.

## Layer 5 — Default Branch Analysis

- `schema_accepts_null` / `make_schema_nullable`: `match kind { String, Array, _ => false }`
  — the `_` correctly covers non-type-descriptor JSON values (a schema `type`
  that is neither a string nor an array of strings cannot declare null). Safe.
- `todo_update_from_params`: `match params.get("content") { None | Some(Null) => None, Some(v) => ... }`
  — the two "leave untouched" cases (absent, null) are handled explicitly; any
  other value must be a string or errors. Correct and intentional.

## Summary

- **1 coherent wire-protocol feature** across 6 files; correctly split into
  outbound (schema), inbound (strip), and tool-level defense layers.
- **Round-trip parity verified** — outbound nullable-set and inbound strip-set are
  keyed off the same source `required` set.
- **0 required fixes** (audit-only PR; no source changed here).
- **2 flags (keep-with-reason / awareness):**
  1. `make_schema_nullable`'s `already_nullable` vs `schema_accepts_null`
     duplication — low-priority dedup candidate, cross-module.
  2. The strip's correctness depends on `enforce_strict_schema` never mutating the
     registered `tool.parameters()` in place — add a call-site comment if touched.
- **1 parity note:** debug `org_runtime` endpoint bypasses the registry strip;
  acceptable (non-model params).
