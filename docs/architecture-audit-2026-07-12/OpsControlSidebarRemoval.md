# Ops Control sidebar removal — architecture audit

Scope: remove the nested Ops Control primary-sidebar implementation after moving its destinations into the expandable app-sidebar item.

## Acceptance criteria

- [x] Ops Control has no nested `WorkStationShell` or primary-sidebar configuration.
- [x] No production reference remains to the removed sidebar component, width/collapse atoms, responsive helper, or focused hook.
- [x] Kanban and Work Items destination selection has one source of truth: the existing internal Ops Control section/project-view atoms.
- [x] Chat-pane titles and icons derive from that same active section and expose no “Ops Control” / “Ops Center” aliases.
- [x] TypeScript compilation, targeted lint, and targeted navigation/Ops Control tests pass.

## 10-layer audit

| Layer                                   | Coverage       | Verdict | Evidence / reason                                                                                                                                                                                                                 |
| --------------------------------------- | -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation correctness              | Covered        | pass    | Full `tsc --noEmit` passes after deleting the component, hook, atoms, and re-exports. No Rust was touched.                                                                                                                        |
| 2. Dead code & structural deduplication | Covered        | fix     | Removed `OpsControlSidebar`, responsive collapse helper/test, Ops-specific persisted width/collapse atoms, `useOpsControlSidebarState`, and both re-export paths. A repository sweep confirms no remaining production references. |
| 3. Naming consistency                   | Covered        | fix     | User-facing chat-pane names now match the navigation destinations: Kanban, Projects, GitHub Issues, and GitHub PRs. Internal `ops-control` IDs remain stable implementation identifiers.                                          |
| 4. Semantic overloading                 | Covered        | fix     | Removed the visible “Ops Control” / “Ops Center” aliases from the chat pane. “Ops Control” remains only the internal singleton host/type name, while each visible destination has one product label.                              |
| 5. Default branch analysis              | Covered        | pass    | Destination and tab-title mappings explicitly cover Kanban, Projects, GitHub Issues, and GitHub PRs. An absent or unknown persisted section safely resolves to Kanban rather than a legacy alias.                                 |
| 6. Cross-domain concept leakage         | Covered        | pass    | Ops-specific navigation remains in the Workstation sidebar connector/Ops module; shared Workstation panel state no longer carries Ops-only width/collapse fields.                                                                 |
| 7. New-developer confusion              | Covered        | fix     | Removed the misleading parallel `usePrimarySidebarState` / `useOpsControlSidebarState` APIs. The expanded parent/child menu now expresses the visible hierarchy directly.                                                         |
| 8. Wire protocol & serialization        | Covered        | fix     | No network schema changed. Persisted chat tabs normalize to canonical section-specific fallback titles, preventing legacy “Ops Control” titles from reappearing after hydration.                                                  |
| 9. Init parity                          | Not applicable | skipped | No initialization entry point or runtime registration path changed.                                                                                                                                                               |
| 10. Resolver symmetry                   | Not applicable | skipped | No multi-source resolver or fallback chain changed.                                                                                                                                                                               |

## Term-overloading check

| Term                | Before                                                                 | After                                                                                                                                              | Verdict   |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Ops Control sidebar | Could mean the global app-sidebar item or the nested resizable rail    | User-facing navigation is Kanban plus expandable Work Items; Ops Control remains only an internal host name                                        | clarified |
| View                | Mixed destination navigation with Kanban/List/Diary presentation modes | Kanban is top-level; Work Items expands to the existing project/work-item list and related destinations; presentation modes are in the 40px header | clarified |
| Management tab      | Displayed as “Ops Control,” “Ops Center,” or a destination title       | The chat tab always displays its active destination: Kanban, Projects, GitHub Issues, or GitHub PRs                                                | clarified |

## Systematic sweep

Searched for `OpsControlSidebar`, `opsControlResponsiveLayout`, `useOpsControlSidebarState`, `workStationOpsControlSidebar`, `ops_control_sidebar_width`, and `ops_control_sidebar_collapsed`. All production definitions, imports, re-exports, tests, and persistence reads/writes were removed. Historical documentation was left intact as an audit trail.
