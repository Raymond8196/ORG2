# Frontend UI Audit — Conversation Minimap

Scope: the non-pagination conversation minimap, its turn preview, and the shared static/virtual group navigation path.

The repository-referenced `frontend-ui-audit` skill is not installed in either documented location. This report follows the required table convention and manually checks design-system usage, arbitrary Tailwind values, accessibility, responsive behavior, and duplicated visual patterns.

| Line                          | Element                     | Verdict          | Reason                                                                                                                                                                                   | Suggested change |
| ----------------------------- | --------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ConversationMinimap.tsx:13`  | Percentage sampling         | keep with reason | Long conversations retain the first and last turn while distributing the remaining markers across the full history; the fixed cap prevents the rail from growing with transcript length. | None.            |
| `ConversationMinimap.tsx:41`  | User preview normalization  | keep with reason | Reuses the same pill stripping, empty-file-heading normalization, and round-preview truncation as existing chat surfaces instead of introducing a second text-cleanup rule.              | None.            |
| `ConversationMinimap.tsx:49`  | Assistant preview selection | keep with reason | Selects the final assistant message from each already-displayed group, avoiding raw tool events and matching the compact turn-summary intent.                                            | None.            |
| `ConversationMinimap.tsx:124` | Navigation landmark         | keep with reason | Uses a labeled `nav`; every marker is a native button with an accessible turn label, focus ring, tooltip association, and `aria-current` for the visible turn.                           | None.            |
| `ConversationMinimap.tsx:150` | Viewport highlighting       | keep with reason | Multiple viewport-intersecting turns may share the primary visual state, while a single nearest handle retains `aria-current` semantics.                                                 | None.            |
| `ConversationMinimap.tsx:129` | Responsive rail             | keep with reason | The named chat-body container keeps the right-edge rail persistent on wide panes while narrow panes show a handle-width floating surface only during active chat scrolling.              | None.            |
| `ConversationMinimap.tsx:176` | Hover/focus preview         | keep with reason | Reuses the shared dropdown panel surface, anchors it to the hovered or focused marker, and exposes the same preview to keyboard users.                                                   | None.            |
| `ConversationMinimap.tsx:183` | Turn timing summary         | keep with reason | Reuses the turn-collapse sidebar's shared duration and clock-range formatter, and omits the row until measurable timing exists.                                                          | None.            |
| `ChatHistoryList.tsx:593`     | Group navigation handle     | keep with reason | One imperative entry point resolves both static DOM scrolling and virtualized group scrolling, so the minimap does not duplicate list-mode branching.                                    | None.            |
| `ChatHistory/index.tsx:1148`  | Non-pagination placement    | keep with reason | The minimap is explicitly gated out of pagination, page-list, and overview states and lives beside—not inside—the scroll content, preserving natural document flow.                      | None.            |

## Summary

- fix: 0
- keep with reason: 10
- abstract: 0
- sweep candidates: none
