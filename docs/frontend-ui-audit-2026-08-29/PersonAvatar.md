# PersonAvatar UI audit

Scope: the new shared `PersonAvatar` primitive and the conversation-surface
avatar sites migrated onto it, plus the sidebar Inbox unread badge that moved
from the row's trailing slot to the label's trailing edge.

## D1 — Raw HTML vs Design System

| Line                                       | Element                      | Verdict          | Reason                                                                                                                                                | Suggested change                                                                  |
| ------------------------------------------ | ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/components/PersonAvatar/index.tsx:47` | `PersonAvatar`               | keep with reason | It is the DS primitive. Composes `Avatar`; adds no raw markup of its own.                                                                             | None.                                                                             |
| `GroupChatMessageBubble.tsx:102`           | Group-chat sender avatar     | fix (done)       | Was a raw `<div class="rounded-full …">` with a file-local six-colour palette; one teammate read as a different person here than in the message list. | Now `<PersonAvatar name={senderName} size={24} />`.                               |
| `session-discussion.tsx:36`                | Discussion comment avatar    | fix (done)       | Was a raw `size-6 rounded-full` div with `bg-fill-3`/`bg-primary-1` and an inline `initialOf` helper.                                                 | Now `PersonAvatar`, with `fallback="✦"` retained for agent reports.               |
| `SessionViewersIndicator.tsx:119`          | Live-viewer avatars          | fix (done)       | Was a raw `size-4` circle hardcoded to `bg-success-6`. Presence is already conveyed by the indicator rendering at all, plus its roster tooltip.       | Now `PersonAvatar size={16}`; the stacking `ring-1 ring-bg-1` moved to a wrapper. |
| `UserChatItem.tsx:636`                     | Shared-message sender avatar | fix (done)       | Used bare `Avatar` with an inline `background-color` and two-letter initials from `createCollabAvatarIdentity` — a third distinct treatment.          | Now `PersonAvatar`; the local `createCollabAvatarIdentity` call is gone.          |
| `SidebarAccountButton.tsx:43`              | Sidebar account avatar       | fix (done)       | The reference treatment. Kept identical output while adopting the shared primitive, so the two cannot drift apart.                                    | Now `PersonAvatar size={20}`.                                                     |
| `UserChatItem.tsx:626`                     | Parent-agent sender avatar   | keep with reason | Not a person — renders `SessionIdentityIcon` for the parent session. A name-seeded gradient would assert an identity it does not have.                | None.                                                                             |
| `workstationSidebarMenuItems.tsx:73`       | Inbox unread badge           | keep with reason | A count pill, not a DS component; no `Badge` primitive exists in `src/components/`.                                                                   | If a third badge appears, extract `components/CountBadge`.                        |

## D2 — Arbitrary Tailwind Value vs Token

| Line                                 | Element           | Verdict          | Reason                                                                                                                                                                                                      | Suggested change |
| ------------------------------------ | ----------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `workstationSidebarMenuItems.tsx:79` | `text-[9px]`      | keep with reason | Tailwind's scale bottoms out at `text-xs` (12px), which is the size being moved away from. Matches the existing `text-[9px]` in `SessionViewersIndicator` overflow chip and `ConversationParticipantsChip`. | None.            |
| `PersonAvatar/index.tsx:54`          | Pixel `size` prop | keep with reason | Inherited from `Avatar`, which drives `width`/`height`/`fontSize` from one number so the glyph scales with the circle. A class-based scale cannot express `fontSize: size * 0.5`.                           | None.            |

## D3 — Hardcoded Sizes / Colors

| Line                        | Element                     | Verdict          | Reason                                                                                                    | Suggested change |
| --------------------------- | --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `Avatar/index.tsx:35-42`    | `GRADIENT_FALLBACK_CLASSES` | keep with reason | Pre-existing. Tailwind palette classes, not literals, and identity colour must stay stable across themes. | None.            |
| `PersonAvatar/index.tsx:51` | `size = 24` default         | keep with reason | Three of the five call sites want 24px; the other two pass explicitly.                                    | None.            |

Removed by this change: the file-local `AVATAR_COLORS` palette in
`GroupChatMessageBubble`, and `bg-success-6`/`text-[9px]` on the viewer chips.

## D4 — Accessibility Basics

| Line                                 | Element               | Verdict          | Reason                                                                                                                                                         | Suggested change |
| ------------------------------------ | --------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `PersonAvatar/index.tsx:54`          | Decorative avatar     | keep with reason | `Avatar` renders `<img alt="">`; the name is always adjacent in text or on the wrapper's `title`/`aria-label`. Naming it twice makes screen readers repeat it. | None.            |
| `workstationSidebarMenuItems.tsx:75` | Badge `aria-label`    | keep with reason | Translated "N unread" preserved verbatim through the move; covered by two existing tests.                                                                      | None.            |
| `NavigationMenuRow.tsx:182,417`      | Label + badge wrapper | keep with reason | Non-interactive `<span>` inside the row's existing `role="button"`.                                                                                            | None.            |

## D5 — Repeated Visual / Structural Patterns

| Line                            | Element                      | Verdict  | Reason                                                                                                                                                                                                                                                         | Suggested change                                                                                                                                                                                                   |
| ------------------------------- | ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5 sites (this change)           | Person avatar                | abstract | 5 occurrences, 4 mutually inconsistent treatments. Seam landed.                                                                                                                                                                                                | `src/components/PersonAvatar` — done.                                                                                                                                                                              |
| 40 sites / 24 files             | Bare `<Avatar>` for a person | watch    | Outside the conversation surface, `<Avatar>` is still called directly with hand-derived initials and no `gradientSeed` — GitHub PR/issue panels, Project Manager, Channels, Kanban. Not all are people (some are repos/orgs), so a blind sweep would be wrong. | **Sweep candidate — not taken.** Needs a per-site people-vs-entity pass before migrating. Hotspots: `PrSidebar.tsx` (4), `AssigneePropertyField.tsx` (4), `PeopleTeamsLabelsFields.tsx` (3), `HistoryTab.tsx` (3). |
| `NavigationMenuItem.labelBadge` | Label-adjacent count slot    | watch    | First consumer. `useProjectsWorkItemMenuItems/menuRows.tsx:361` and `cloudSessionsSection.rowItemBuilder.tsx:244` still use `trailingElement` for row-edge content, which is the correct slot for them.                                                        | Revisit if a second count badge appears.                                                                                                                                                                           |

Verdict totals: **5 fix (all applied)**, **9 keep with reason**, **1 abstract**, **2 watch**.

## Sweep candidate not taken

40 direct `<Avatar>` call sites across 24 files still bypass `PersonAvatar`.
Migrating them is a config-level decision, not a silent per-site edit: several
render non-human entities (repositories, organizations, agents) where a
name-seeded identity gradient would be actively misleading. Raised here for the
user to decide.
