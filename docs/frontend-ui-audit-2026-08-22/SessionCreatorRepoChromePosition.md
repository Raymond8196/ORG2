# Session Creator repository chrome position UI audit

The documented `frontend-ui-audit` skill was unavailable at both the global and workspace paths. This manual fallback applies the repository's required design-system, spacing, localization, and accessibility checks to the changed UI.

| Line / file                       | Element                            | Verdict          | Reason                                                                                                                                                            | Suggested change |
| --------------------------------- | ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `RepoChromeRow.tsx`               | Secondary-click native menu        | keep with reason | Uses the shared Tauri native-menu lifecycle, prevents the WebView's Back/Reload/Inspect menu, and marks the current Up/Down choice with the native checked state. | None.            |
| `SessionCreatorChatPanelView.tsx` | Stable composer/chrome slots       | keep with reason | Keeps the composer in a stable render slot while moving only the chrome; bottom chrome is outside the complete composer frame, preventing input remount flashes.  | None.            |
| `repoChromeLayout.ts`             | Position-aware padding and glow    | keep with reason | Both sides mirror `1.5` outer / `2.5` seam padding, while the launchpad glow is intentionally limited to top chrome so it cannot paint across the bottom seam.    | None.            |
| `index.scss`                      | Top and bottom composer attachment | keep with reason | The established negative seam overlap, corner radii, and z-order remain unchanged; the flashing fix does not alter the existing visual layering.                  | None.            |
| `locales/*/sessions.json`         | Native-menu choices                | keep with reason | All supported locales define the two native-menu choices; no locale relies on raw English UI copy.                                                                | None.            |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

No multi-file sweep candidate was found: this is the only independently movable repository chrome in Session Creator, while Workstation panel position controls represent a different surface and axis.
