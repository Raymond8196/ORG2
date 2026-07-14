# Task Kanban test cases

## Imported-history source filters

| Case                                | Expected result                                                       | Coverage                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A Warp imported session is present  | The agent filter includes `Warp` and selecting it keeps Warp sessions | `config.test.ts`; `KanbanHeaderFilters` derives the label from the imported-source registry |
| Another imported source is selected | Warp sessions do not match that source filter                         | Type-safe `EXTERNAL_HISTORY_FILTER_BY_SOURCE` lookup in `useTaskKanbanFilters`              |
| No Warp imported session is present | The Warp option is omitted from the compact filter list               | Existing present-source filtering in `KanbanHeaderFilters`                                  |

Manual acceptance: import at least one Warp conversation, open Agent Kanban, choose **Warp**, and confirm only `warpapp-*` cards remain visible.
