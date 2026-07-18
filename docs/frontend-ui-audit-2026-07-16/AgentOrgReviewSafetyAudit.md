# Agent Org PR Review — Frontend UI Audit

- Date: 2026-07-16
- Scope: frontend changes required by the two PR #373 review rounds
- Status: source audit and A-only verification complete, with a documented clean-develop rendered baseline
- Verification date: 2026-07-18

## Audit table

| Line / surface                                  | Element                              | Verdict          | Reason                                                                                                                                                                                     | Suggested change                                                                                     |
| ----------------------------------------------- | ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/api/tauri/agent/orgTasks.ts`               | Compact Run View contract            | keep with reason | Task totals, unread totals, Plan summaries, and Inbox previews match the backend's read-only Snapshot. Complete content is loaded through explicit detail or history APIs.                 | Keep summary-by-default and avoid restoring full payloads to the poll response.                      |
| `AgentOrgOverviewPanel.tsx`                     | Exact overview counters              | keep with reason | Counters come from backend totals instead of the visible Task or Inbox window. The user is told when only a Task prefix is shown.                                                          | None.                                                                                                |
| `agentOrgRunViewStore.ts`                       | Shared Run poller                    | keep with reason | Root and member consumers share one per-Run poll path while preserving caller-specific `currentMemberId`.                                                                                  | Preserve one durable Snapshot source per Run.                                                        |
| `agentOrgRunViewStore.test.ts`                  | Snapshot identity                    | fix              | `useSyncExternalStore` requires repeated reads to return the same object until state changes. The regression verifies stable identity before a member subscribes.                          | Keep the referential-equality assertion.                                                             |
| `useAgentOrgPlanApprovalDetail.ts`              | Plan summary/detail split            | keep with reason | Polling carries immutable revision identity and title only. The full Plan loads once per revision, concurrent loads coalesce, and failures are retryable.                                  | Keep detail loading explicit; cache-cap policy is outside this follow-up.                            |
| `AgentOrgPlanApprovalCard.tsx`                  | Plan loading and submission states   | keep with reason | Loading, retry, edit, feedback, submit, paused, and stale-revision states remain distinct. Existing `Button`, `Textarea`, and `Markdown` primitives are reused.                            | None.                                                                                                |
| `useAgentOrgGroupChatHistory.ts`                | Durable keyset history               | fix              | Reload no longer relies on a bounded Run View preview. History pages merge by Inbox id, preserve older rows, retain cursor frontiers across refresh gaps, and expose retry state.          | Keep cursor pagination and explicit Load older behavior. Extra cache caps belong to later hardening. |
| `ChatView.tsx`                                  | Load older and retry controls        | keep with reason | Existing button and pagination surfaces expose history progress without introducing a parallel navigation pattern.                                                                         | None.                                                                                                |
| `useGroupChatMergedEvents.ts`                   | Durable user-message projection      | keep with reason | User Group Chat turns are built from persisted history rows, while compact Inbox previews are used only to annotate reply cutoffs.                                                         | Do not parse full Inbox payload JSON during render.                                                  |
| `useAgentOrgGroupChatController.ts`             | Optimistic send plus durable refresh | keep with reason | A pending message is rendered immediately, then replaced by the persisted Inbox id and refreshed through the keyset history source.                                                        | None.                                                                                                |
| `useUserIntentSubmit.ts`                        | Direct-send intervention boundary    | fix              | A direct user message must establish member intervention after its durable event is appended and immediately before provider dispatch. Failure to persist intervention must stop dispatch. | Keep the operation fail closed and do not move it back to composer-submit time.                      |
| `useQueueDispatch.ts`                           | Queued-send intervention boundary    | fix              | A queued message must not suppress background Wake while merely waiting. Intervention is established only when the item is actually dequeued for provider dispatch.                        | Preserve dispatch-time ordering and fail closed on persistence failure.                              |
| Direct/queued intervention tests                | Dispatch-order regression coverage   | fix              | Five focused tests cover direct dispatch, queued dispatch, queue waiting, ordering, and persistence failure behavior.                                                                      | Retain all five tests as required dependency coverage.                                               |
| `OrgTaskAdapter.tsx`                            | Task outcome memoization             | fix              | The structured outcome is resolved once per render and reused by every Task branch instead of reparsing a large wrapped result.                                                            | Keep explicit outcomes authoritative.                                                                |
| `orgTaskOutcome.ts`                             | Legacy success evidence              | fix              | Persisted legacy events must show durable result evidence. Args alone cannot make a failed create, update, delete, list, or get operation appear successful.                               | Retain the action matrix regression.                                                                 |
| `TaskUpdateCard.tsx` / `ToolCallBlock/types.ts` | Task Graph card                      | fix              | Atomic graph creation uses a typed `graph` discriminant and existing Task-list primitives instead of raw JSON.                                                                             | None.                                                                                                |
| `AgentEventBubbles.tsx`                         | Task Graph routing                   | fix              | `task_graph_create` is registered through shared tool names and reaches the Agent Org renderer on live and replay surfaces.                                                                | None.                                                                                                |
| `TodoKanban.tsx`                                | Additive Task replay                 | fix              | Graph creation adds rows without clearing earlier Tasks; successful deletion removes a row; rejected or failed operations leave the board unchanged.                                       | Keep durable Run View as the live source of truth.                                                   |
| Changed TSX set                                 | Design-system reuse                  | keep with reason | New controls reuse repository buttons, text areas, Markdown, Task cards, Kanban, and pagination components. No new color, spacing, or input system is introduced.                          | If compact typography is standardized later, use a repository-wide design-token sweep.               |
| Changed TSX set                                 | Accessibility and error state        | keep with reason | Plan errors use alerts, fields retain labels, buttons expose disabled/loading state, and history failures have a visible retry action.                                                     | None.                                                                                                |

## Changed-file coverage

This A-only audit covers the frontend implementation and tests for:

- compact Agent Org Run View types and overview counters;
- stable shared Snapshot identity;
- Plan summary/detail loading and approval submission;
- keyset Group Chat history, reload, pagination, retry, and persisted display text;
- Task Graph extraction projection, Task cards, Task outcomes, deletion, and Kanban replay;
- direct and queued user-intervention timing at the canonical provider-dispatch boundary, including five focused regressions;
- rendered Group Chat, Plan approval, pause/resume, and recovery fixtures required by these review fixes.

This report covers only the frontend changes required by the two review rounds and their minimum integration dependencies. Later UI hardening is tracked outside this branch.

## Verification status

Results from the previous combined tree are not treated as A-only evidence.

| Gate                                      | A-only result                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Direct/queued intervention regressions    | Pass: 5 / 5.                                                                                                   |
| Full Vitest suite                         | Pass: 5,318 / 5,318.                                                                                           |
| TypeScript typecheck                      | Pass.                                                                                                          |
| ESLint and circular-dependency check      | Pass.                                                                                                          |
| Isolated real Debug App HTTP E2E          | Pass: 46 / 46.                                                                                                 |
| Rendered Group Chat WebDriver scenarios   | 5 / 6 pass. The remaining mention-menu scenario fails identically on clean develop and is not an A regression. |
| Rendered Pause/Resume WebDriver scenarios | Pass: 8 / 8.                                                                                                   |
| Rendered Recovery WebDriver scenarios     | Pass: 2 / 2.                                                                                                   |

## Verdict summary

- Review fixes represented: compact polling, durable history, Plan detail, structured Task outcomes, Task Graph rendering, additive Kanban replay, and dispatch-time user intervention.
- New design-system abstractions: 0.
- Out-of-scope follow-up UI changes included: 0.
- Confirmed blocking source/UI findings: 0.
- Rendered acceptance: all A-scope scenarios pass; one clean-develop mention-menu baseline remains explicitly excluded.

## Conclusion

The frontend remains a projection layer over durable backend facts. High-frequency reads stay compact, complete history and Plan content load on demand, failed Task attempts cannot masquerade as persisted success, and direct or queued user takeover is established only at actual dispatch. Unit, static, HTTP, and in-scope rendered verification are complete. The one remaining rendered mention-menu failure is reproduced on clean develop and is not attributed to this A-only follow-up.
