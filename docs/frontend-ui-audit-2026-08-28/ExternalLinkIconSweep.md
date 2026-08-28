# External-link icon sweep UI audit

| Line                                                                      | Element                                 | Verdict          | Reason                                                                                                                                    | Suggested change                                             |
| ------------------------------------------------------------------------- | --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/icons.ts:386`                                                        | Central external-navigation icon export | fix              | `SquareArrowUpRightIcon` does not match the requested common external-navigation treatment.                                               | Export `SquareArrowUpRight02Icon` and update every consumer. |
| `src/engines/ChatPanel/blocks/primitives/EventNavigateIcon.tsx:51`        | Event navigation icon selection         | keep with reason | The branch selects iconography by navigation destination; it is not a duplicated button or navigation-control implementation.             | None.                                                        |
| `src/modules/MainApp/TeamInbox/components/AssignedWorkItemDetail.tsx:367` | Open-in-app action                      | keep with reason | The action already uses the shared `HugeiconsIcon` renderer and retains its existing accessible button semantics; only its glyph changes. | None.                                                        |
| `src/modules/WorkStation/shared/StatusBar/CiStatusMenu.tsx:192`           | External check-details action           | keep with reason | The status-bar menu uses its local control family and the icon substitution preserves its established size, color, tooltip, and label.    | None.                                                        |

## Sweep notes

- D2 — No arbitrary Tailwind values or token use changed.
- D3 — The sweep preserves all existing icon sizes, colors, and stroke widths.
- D4 — No interaction or accessibility semantics changed.
- D5 — The 50 consumer files share the centralized `src/icons.ts` export; the requested glyph is therefore applied consistently without introducing a new component abstraction.

Verdict totals: **1 fix**, **3 keep with reason**, **0 abstract**.
