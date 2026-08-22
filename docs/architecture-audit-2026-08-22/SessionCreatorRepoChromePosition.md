# Session Creator repository chrome position architecture audit

## Acceptance criteria

- Users can place the repository/branch/location chrome above or below the composer.
- Right-clicking that chrome opens the native OS Up/Down menu instead of WebKit's browser menu.
- An explicit choice persists across app restarts and every Session Creator entry point.
- Existing first-run behavior remains unchanged: Launchpad defaults above and standard layouts default below.
- Top and bottom presentations mirror the same outer and composer-seam padding.
- The native context menu is the only position control; no duplicate visible switch is rendered.
- Compact or hidden repository chrome does not expose an inapplicable position control.
- Bottom chrome renders outside the complete composer frame and disables the launchpad input glow to avoid flashing across the chrome seam.

## Ten-layer review

| Layer                      | Verdict        | Evidence                                                                                                                                                                                                                                         |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Compilation             | pass           | Full `tsc --noEmit`, focused ESLint, and the focused eight-test Vitest suite pass.                                                                                                                                                               |
| 2. Dead code / duplication | pass           | The native context menu is the single position control; the coordinator resolves its persisted preference and the view uses that value for row order, glow behavior, and presentation classes. No parallel preference or layout state was added. |
| 3. Naming                  | pass           | `CreatorRepoChromePosition`, `repoChromePosition`, and `RepoChromeRow` consistently refer only to the repository/branch/location strip.                                                                                                          |
| 4. Semantic overloading    | pass           | The persisted value models spatial position (`top`/`bottom`) only; it does not encode layout kind, visibility, or dropdown direction.                                                                                                            |
| 5. Default branches        | pass           | The unset preference is represented explicitly as `null`; Launchpad and standard fallbacks are selected explicitly. Malformed stored values normalize to `null` instead of silently becoming one position.                                       |
| 6. Cross-domain leakage    | pass           | The session store owns the global preference; the Session Creator coordinator owns layout fallback; the presentational view owns DOM ordering and classes. No backend or unrelated Workstation concept is imported.                              |
| 7. New-developer clarity   | pass           | The atom documents why `null` exists, the layout helper names the above-composer and breathing decisions, and the two native-menu options are localized as Up and Down.                                                                          |
| 8. Wire protocol           | not applicable | The preference is local UI storage only; no Tauri, HTTP, database, or serialized external payload changes.                                                                                                                                       |
| 9. Init parity             | pass           | Launchpad, standard, compact, and hidden-repository variants all enter through `SessionCreatorChatPanelContent` and read the same persisted atom. The entry-point matrix below records the intentional presentation differences.                 |
| 10. Resolver symmetry      | not applicable | No multi-field resolver or fallback chain was introduced; one preference resolves against one layout-specific fallback.                                                                                                                          |

## Entry-point matrix

| Entry point                 | Unset preference        | Explicit preference        | Native menu |
| --------------------------- | ----------------------- | -------------------------- | ----------- |
| Launchpad repository chrome | Above composer          | Honored                    | Available   |
| Standard repository chrome  | Below composer          | Honored                    | Available   |
| Compact embedded chrome     | Existing compact header | Not applied while embedded | Unavailable |
| Hidden repository chrome    | Not rendered            | Not applied while hidden   | Unavailable |

## Term table

| Term                | Meaning                                                                                        | Owner                       |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------- |
| repository chrome   | Repository, branch, and running-location control strip around the Session Creator composer     | Session Creator view        |
| position preference | Persisted explicit `top` or `bottom`; `null` means no choice has been made                     | Session store atom          |
| layout fallback     | Existing first-run position selected from Launchpad versus standard layout                     | Session Creator coordinator |
| native context menu | Tauri OS menu that suppresses the WebView browser menu and writes the same position preference | Repository chrome row       |
