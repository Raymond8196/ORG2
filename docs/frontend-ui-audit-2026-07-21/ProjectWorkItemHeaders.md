# Frontend UI Audit — Project and Work Item Headers

**Scope:** Projects and Work Items list headers, detail/create headers, and the
corresponding Chat panel header publishers. Body content and Project Org
surface navigation are intentionally out of scope.

The repository-referenced `frontend-ui-audit` skill was unavailable at both
documented paths, so this report follows the fallback table convention in
`AGENTS.md`.

| Line                                                                                         | Element                       | Verdict          | Reason                                                                                                                                        | Suggested change                                                                                      |
| -------------------------------------------------------------------------------------------- | ----------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb/index.tsx:22`         | Shared project breadcrumb     | abstract         | Project, Work Item, and creation headers repeated title sizing, truncation, separators, and click behavior.                                   | Centralize explicit display segments, icons, callbacks, and the 40 / 24+36 character rules here.      |
| `src/modules/ProjectManager/Projects/components/ProjectsPageHeader/index.tsx:80`             | Projects list header          | fix              | Identity and actions were published together as one content fragment, allowing controls to drift into the flexible title region.              | Publish breadcrumb identity through `content` and controls through `trailing`.                        |
| `src/modules/ProjectManager/WorkItems/components/WorkItemsPageHeader/index.tsx:352`          | Work Items list header        | fix              | The list header used the same monolithic publisher pattern and a different outer action gap.                                                  | Use the semantic slot split and the shared compact action spacing.                                    |
| `src/modules/ProjectManager/WorkItems/components/WorkItemDetail/WorkItemDetailHeader.tsx:37` | Work Item detail breadcrumb   | fix              | The detail view hand-built a 12px breadcrumb and omitted the short ID from the visible leaf title.                                            | Use the shared 13px breadcrumb with Project > `short ID · title`, a work-item icon, and parent click. |
| `src/modules/ProjectManager/WorkItems/components/WorkItemDetail/index.tsx:286`               | Work Item detail publisher    | fix              | Detail navigation and property actions were attached to the flexible content slot.                                                            | Publish the breadcrumb and action cluster independently and compose the same pieces inline.           |
| `src/modules/ProjectManager/shared/components/DetailSplitLayout/index.tsx:119`               | Create/detail fallback header | fix              | Creation views retained a plain 12px title and raw header publication.                                                                        | Route primitive breadcrumbs and fallback titles through the shared renderer; publish actions last.    |
| `src/engines/ChatPanel/panels/ProjectPanelView.tsx:136`                                      | Chat Project header           | fix              | The Project tab left the shared 40px header identity area blank.                                                                              | Publish Organization > Project with a project icon.                                                   |
| `src/engines/ChatPanel/panels/WorkItemPanelView.tsx:494`                                     | Chat Work Item header         | fix              | The Work Item tab published only property/delete actions, leaving no identity or hierarchy in the shared bar.                                 | Publish Project > `short ID · title` and retain actions in `trailing`.                                |
| `src/modules/WorkStation/TabContent/renderers/githubIssueDetail.tsx`                         | GitHub issue header           | keep with reason | It already publishes a 13px state/number/title identity and a separate trailing action cluster through the shared workstation slots.          | Keep the renderer-specific issue state treatment.                                                     |
| `src/modules/WorkStation/TabContent/renderers/githubPrDetail.tsx`                            | GitHub pull-request header    | keep with reason | PR state, number, title, and branch direction are a compact domain-specific identity already rendered inside the shared 40px workstation bar. | Keep the PR-specific metadata grouping.                                                               |

## Verdict summary

- Fix: 7
- Keep with reason: 2
- Abstract: 1
- Multi-file sweep candidates: 0

Accessibility check: clickable parent breadcrumbs remain keyboard-focusable
through the shared breadcrumb control, full labels remain available through
titles after visual truncation, icon-only actions retain their existing labels
and tooltips, and separators remain hidden from assistive technology.
