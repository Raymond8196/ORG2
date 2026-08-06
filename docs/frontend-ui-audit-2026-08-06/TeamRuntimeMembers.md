# Frontend UI Audit — Team Runtime Members

## Scope

The Runtime → Team member breakdown and individual-member headers, activity
grouping, and stale-card presentation.

The configured `frontend-ui-audit` skill file was unavailable at both documented
locations, so this report applies the repository's audit format and the existing
Team Runtime Today/header conventions directly.

## Findings

| Line                       | Element                        | Verdict          | Reason                                                                                                                                          | Suggested change                                                                                  |
| -------------------------- | ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `TeamRuntimePanel.tsx:357` | Member breakdown title row     | fix              | The title and refresh action were rendered in separate rows, unlike the adjacent Today surface and the requested compact header hierarchy.      | Keep the heading and shared refresh button in one responsive `justify-between` row.               |
| `TeamMemberDetail.tsx:179` | Individual-member header       | fix              | Back and refresh were split across stacked control rows, leaving excess whitespace before the member identity.                                  | Keep Back and the injected shared refresh action in one `justify-between` row.                    |
| `TeamRuntimePanel.tsx:386` | Today-activity member sections | fix              | A single undifferentiated grid made active and inactive members harder to scan.                                                                 | Preserve the semantic `section`/heading split driven by the same UTC-day activity rule as Today.  |
| `TeamRuntimePanel.tsx:394` | Responsive member grids        | keep with reason | The existing one-to-two-column container breakpoint fits the card minimum width and is already established by this surface.                     | Keep the existing container-query breakpoint for both activity groups.                            |
| `TeamMemberCard.tsx:117`   | Stale member card presentation | fix              | Applying `opacity-60` to the whole interactive card made reported data and the card action appear disabled even though both remained available. | Keep cards fully opaque; retain non-visual freshness metadata for diagnostics and future signals. |
| `TeamRuntimePanel.tsx:368` | Refresh action                 | keep with reason | The existing `RuntimeRefreshButton` supplies the shared Button treatment, accessible label/title, loading spin, and duplicate-request guard.    | Continue reusing the shared local action instead of introducing breakdown-specific button markup. |

## Verdict counts

- fix: 4
- keep with reason: 2
- abstract: 0

## Accessibility and visual-system notes

The breakdown uses ordered heading levels (`h3` followed by `h4`) and semantic
sections. The detail header keeps two native labeled buttons in a predictable
left/right navigation row. Member cards remain native enabled buttons and no
longer rely on reduced opacity to communicate state. The refresh control retains
an accessible label, and the layout continues to use existing spacing, color,
border, radius, and heading tokens. No arbitrary colors or new one-off pixel
values were added.
