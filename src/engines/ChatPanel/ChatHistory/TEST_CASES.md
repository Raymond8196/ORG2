# Test Cases: ChatHistory

## Preconditions

- Session is loaded with a non-empty event array.
- `ChatHistory` is rendered inside `ChatSessionContext`, Jotai provider, and i18n context.
- `GroupedVirtuoso` scroll container is mounted in a layout with measurable height.
- Pagination feature flag and `useChatPagination` hook are initialized.

## Happy Path

| #   | Steps                                         | Expected Result                                                                                                          |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Disable pagination; open several turns.       | User messages render as right-aligned bubbles in chronological flow; scrolling does not pin or duplicate a turn header.  |
| 2   | Session is active; agent posts a new message. | New item appended at bottom; auto-scroll follows if user was at bottom.                                                  |
| 3   | User sends a new message.                     | Optimistic turn added to list immediately.                                                                               |
| 4   | Click "Collapse all" button.                  | All expanded tool-call blocks collapse; `collapseAllCommandAtom` fires.                                                  |
| 5   | Toggle collapse on an individual turn.        | `turnCollapseOverrideAtom` updates; only that turn collapses/expands.                                                    |
| 6   | Pagination enabled; history exceeds one page. | `TurnPaginationControls` and the pinned turn header remain available; clicking prev/next navigates to the adjacent page. |
| 7   | Search bar opened; type a query.              | `ChatSearchBar` highlights matching turns; non-matching items dimmed or filtered.                                        |
| 8   | Revert button clicked on a turn.              | `RevertConfirmDialog` opens; confirming reverts session state.                                                           |
| 9   | Agent is planning; planning indicator shown.  | `usePlanningIndicator` returns `true`; planning spinner/indicator visible.                                               |
| 10  | Cursor IDE session with turn summaries.       | `cursorIdeTurnSummariesAtomFamily` data renders inline on matching turns.                                                |

## Edge Cases

| #   | Scenario                             | Steps                                         | Expected Result                                                      |
| --- | ------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Empty session                        | Session has zero events.                      | `ChatHistoryEmptyState` renders; no crash.                           |
| 2   | Single turn                          | Session has exactly one turn.                 | Renders correctly; pagination controls hidden or disabled.           |
| 3   | Duplicate events from dedup pipeline | Events pipeline returns deduped list.         | Each event appears exactly once; no duplicates in DOM.               |
| 4   | Very long session (500+ turns)       | Open session with many turns.                 | Virtuoso windowing ensures only visible turns are in DOM.            |
| 5   | Rapid new messages                   | 10 messages arrive in quick succession.       | All appended; auto-scroll behaves without jump/flicker.              |
| 6   | Chat pinned content                  | `usePinnedContent` returns non-empty list.    | `ChatPinnedBars` renders pinned items above the list.                |
| 7   | Group chat mode                      | Session is an agent-org group chat.           | `isAgentOrgGroupChatUserMessage` path renders group-specific header. |
| 8   | Paginated page 2 with no turns       | Navigate to page 2 that has 0 visible turns.  | Empty state or "no turns on this page" message shown.                |
| 9   | Search query with no results         | Type a unique string that matches nothing.    | Empty result state shown in search mode.                             |
| 10  | Revert dialog cancelled              | Open revert dialog; click Cancel.             | Dialog closes; no state mutation.                                    |
| 11  | Empty injected file section          | Message contains only the file-section title. | The heading-only user bubble is omitted.                             |

## Error / Degraded States

| #   | Scenario                     | Steps                                                     | Expected Result                                           |
| --- | ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Session atom rejects         | Session atom throws.                                      | Error boundary catches; fallback UI shown.                |
| 2   | Item renderer throws         | A single `ChatItemRenderer` throws for a malformed event. | Error boundary catches per-item; rest of history renders. |
| 3   | Scroll container zero height | `GroupedVirtuoso` mounted in 0-height container.          | No infinite loop; renders gracefully.                     |

## Accessibility

- [ ] Keyboard-navigable (Tab through turns; Enter to expand/collapse)
- [ ] Screen reader label on list container (announced as "Chat history")
- [ ] Pagination-mode pinned headers do not duplicate focusable controls
- [ ] Non-pagination user bubbles preserve keyboard access to copy/edit/restore controls
- [ ] Focus trap not applicable (scrollable list, not a modal)

## Acceptance Criteria

- [ ] All turns render in correct chronological order
- [ ] Non-pagination mode uses natural scrolling without pinned turn headers
- [ ] Non-pagination user messages are compact right-aligned bubbles
- [ ] Auto-scroll follows agent when user is at bottom
- [ ] Collapse-all collapses all tool-call blocks
- [ ] Pagination controls navigate between pages correctly
- [ ] Search highlights matching turns
- [ ] Empty session shows empty state
- [ ] Duplicate events are deduplicated by the pipeline
- [ ] `pnpm test` passes with no new failures
- [ ] No TypeScript errors (`pnpm typecheck`)
