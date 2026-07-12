# Ops Control → ChatPanel tab migration architecture audit

## Acceptance criteria

- The Workstation no longer mounts a dedicated Ops Control station view or tab bar.
- Ops Control is a singleton ChatPanel tab; Projects is an internal section of that tab.
- The active management tab is the source of truth for its title, rendered content, and Ops sidebar selection.
- The active management tab also drives the outer Workstation sidebar highlight; the retired Ops route is only a deep-link compatibility entry point.
- Every tab pill resolves from its canonical tab type or linked entity; surface-header and globally active-session titles cannot override another tab's identity.
- Selecting a session in the Workstation sidebar focuses its existing session tab or creates and activates one; Launchpad cannot remain the active tab while session content opens.
- The Ops Control tab defaults to full-screen ChatPanel presentation on entry and restores the user's prior maximize state on exit when the user has not explicitly restored the Workstation.
- The management tab keeps the top tab bar and maximize/Workstation toggle so full screen remains user-reversible, while suppressing the focused Workstation rail.
- Launchpad names the Work / Explore / Trend start page; Dashboard names the workspace summary surface and uses an Info icon.
- Every ChatPanel tab is closable; closing the final tab creates and activates the three-section Launchpad.
- Closing Ops Control disposes its transient creator, preview, replay-event, playback, header, and legacy focus state while retaining persisted user preferences.
- Legacy persisted tabs that used `launchpad` for the workspace summary migrate to `dashboard`; former Projects tabs merge into the single Ops Control tab while preserving the Projects section.
- The existing Ops Control sidebar remains the navigation owner for Sessions, Work Items, Projects, Kanban, List, and Diary.
- The legacy route and existing shortcut/action entry points converge on one `openOpsControlTab()` service path.
- Removed Workstation tab types/renderers have zero remaining references.
- Targeted ESLint, TypeScript, and tab-state tests pass.

## Ten-layer audit

| Layer                                 | Coverage                                                | Verdict          | Evidence / reason                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation correctness            | TypeScript + changed-file lint                          | pass             | `pnpm exec tsc --noEmit --pretty false` and targeted ESLint complete with zero errors. Rust is untouched.                                                                                         |
| 2. Dead code / structural duplication | Old station path, duplicate identity, retained UI state | pass             | Deleted the old Ops path and Projects tab type, replaced writable management selection with an active-tab projection, and centralized transient Ops cleanup in the canonical tab-close path.      |
| 3. Naming consistency                 | Chat tab and service names                              | pass             | `start-page` is the Launchpad with Work / Explore / Trend; `dashboard` is the workspace summary; `ops-control` owns both management sections under one visible tab identity.                      |
| 4. Semantic overloading               | `launchpad`, `dashboard`, `project`, `station`, `tab`   | pass             | Launchpad and Dashboard no longer label the same surface, surface-header context no longer doubles as tab identity, and Projects is explicitly an inner Ops section rather than another tab.      |
| 5. Default branches                   | Tab activation, presentation, and empty-tab fallback    | pass             | Every tab variant explicitly synchronizes legacy surface state; management/terminal tabs use Session only as a neutral underlying surface. Final close explicitly activates Launchpad.            |
| 6. Cross-domain leakage               | ChatPanel ↔ Ops Control                                 | keep with reason | ChatPanel owns surface identity/presentation; Ops Control continues to own its sidebar and management content. The shell lazy-load is an intentional host boundary, not duplicated domain logic.  |
| 7. New-developer clarity              | Entry points and ownership                              | pass             | `openOpsControlChatPanelTabAtom`, `isChatPanelTabDefaultFullscreen`, and `openOpsControlTab` distinguish entry defaults from enforced presentation.                                               |
| 8. Wire protocol / serialization      | External payloads and local persistence                 | pass             | No backend protocol changed. LocalStorage normalization maps legacy Launchpad and Projects identities to Dashboard and the singleton Ops Control tab respectively; terminal tabs remain excluded. |
| 9. Init parity                        | Route, shortcut, Spotlight, action, plus menu, sidebar  | pass             | All Ops entry points converge on one tab atom; session rows focus linked tabs, while sidebar New Chat resets the draft and then creates and activates the localized Launchpad tab.                |
| 10. Resolver symmetry                 | Tab presentation and management selection               | pass             | Ops Control and Projects follow the same activation chain; title, tab identity, content section, and outer sidebar highlight all resolve from the same active tab.                                |

## Entry-point parity matrix

| Entry point                             | Opens singleton tab | Makes chat visible | Defaults full screen | Workstation restorable | Selects Ops home | Normalizes legacy route |
| --------------------------------------- | ------------------: | -----------------: | -------------------: | ---------------------: | ---------------: | ----------------------: |
| Shortcut / Action / Spotlight           |                 yes |                yes |                  yes |                    yes |              yes |                     yes |
| Legacy `/workstation/ops-control` route |                 yes |                yes |                  yes |                    yes |              yes |                     yes |
| ChatPanel `+` menu                      |                 yes |    already visible |                  yes |                    yes |              yes |                     n/a |
| Retained Ops sidebar                    |                 yes |    already visible |                  yes |                    yes |              yes |                     n/a |

## Scoped-out layers

No Rust, database, session initialization, external wire protocol, queue lifecycle, or resolver logic changed. Those skill checklist areas were inspected for applicability and intentionally skipped beyond the explicit Layer 8–10 statements above.
