# Frontend UI Audit — Launchpad Navigation

**Scope:** Launchpad inner navigation, embedded Work Item composer, and utility action grouping.

The repository-referenced `frontend-ui-audit` skill was unavailable at both documented paths, so this report follows the fallback table convention in `AGENTS.md`.

| Line                                                  | Element                    | Verdict          | Reason                                                                                                                                                                       | Suggested change                                                                                       |
| ----------------------------------------------------- | -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/engines/ChatPanel/ChatPanelStartPage.tsx:240`    | Launchpad navigation row   | keep with reason | The row reuses the shared `TabPill` simple variant, Runtime's centered content width, and the chat-pane surface token instead of adding a local tab primitive.               | None.                                                                                                  |
| `src/engines/ChatPanel/ChatPanelStartPage.tsx:243`    | Session / Work Item / More | fix              | All three views now remain inside the Launchpad page, keeping their relationship visible and avoiding a second navigation layer.                                             | Default to Session, embed the full work-item creator, and group update/import/API-key actions in More. |
| `src/engines/ChatPanel/ChatPanelStartPage.tsx:272`    | Conditional view content   | keep with reason | One active view is rendered at a time, which keeps keyboard focus and screen-reader navigation from reaching controls hidden by another tab.                                 | None.                                                                                                  |
| `src/engines/ChatPanel/ChatPanelEmptyContent.tsx:133` | Work Item composition      | keep with reason | Launchpad and direct work-item entry reuse the same creator composition, preserving title, properties, Agent mode, composer, and footer behavior without duplicating markup. | Keep the Agent toggle inline when the creator is hosted inside Launchpad.                              |
| `src/engines/ChatPanel/ChatPanelStartPage.test.ts:16` | View-state coverage        | fix              | The former tests assumed every action was visible at once and explicitly asserted that no inner tabs existed.                                                                | Cover Session, Work Item, and More independently, including the conditional update action.             |
| `src/i18n/locales/en/sessions.json:926`               | Navigation labels          | fix              | User-facing tab labels must remain localized consistently across all supported locales.                                                                                      | Add Session, Work Item, and More keys to each sessions locale.                                         |

## Verdict summary

- Fix: 3
- Keep with reason: 3
- Abstract: 0
- Multi-file sweep candidates: 0
