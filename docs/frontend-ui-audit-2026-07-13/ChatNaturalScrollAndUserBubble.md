# Frontend UI Audit — Chat Natural Scroll and User Bubble

Scope: non-pagination chat scrolling, turn-header pinning, and the user-message presentation in `ChatHistory`, `ChatHistoryList`, `GroupHeaderRenderer`, and `UserChatItem`.

The repository-referenced `frontend-ui-audit` skill is not installed in either documented location. This report follows the required table convention and manually checks design-system usage, arbitrary Tailwind values, accessibility, responsive behavior, and duplicated visual patterns.

| Line                          | Element                           | Verdict          | Reason                                                                                                                                                                                                 | Suggested change |
| ----------------------------- | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `ChatHistory/index.tsx:1030`  | Pinned turn header                | keep with reason | The external pinned turn copy is explicitly limited to pagination mode; agent-organization context controls remain independently available.                                                            | None.            |
| `ChatHistoryList.tsx:690`     | Inline header cleanup             | keep with reason | The list clears the visibility and `aria-hidden` values previously written by the pagination pin path, preventing stale hidden headers when pagination is switched off without remounting the list.    | None.            |
| `GroupHeaderRenderer.tsx:237` | User-message presentation routing | keep with reason | The existing user-message component is reused with a presentation prop, retaining edit, restore, attachment, and pinned-content behavior instead of creating a parallel message renderer.              | None.            |
| `UserChatItem.tsx:354`        | Right-aligned bubble              | keep with reason | Uses semantic fill tokens for a consistent message surface, preserves standard spacing, and reserves left-side room for the external actions without introducing raw colors or a new layout primitive. | None.            |
| `UserChatItem.tsx:369`        | Copy/edit action cluster          | keep with reason | Actions sit outside the bubble on its left without a group surface and remain visible for pointer hover and keyboard focus; the existing labeled buttons and focus-ring tokens are preserved.          | None.            |

## Summary

- fix: 0
- keep with reason: 5
- abstract: 0
- sweep candidates: none
