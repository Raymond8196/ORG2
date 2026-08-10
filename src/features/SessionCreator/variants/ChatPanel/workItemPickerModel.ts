import type {
  EnrichedWorkItem,
  WorkItemData,
  WorkspaceWorkItemsData,
} from "@src/api/http/project";
import { projectApi } from "@src/api/http/project";
import type {
  GitHubIssue,
  OpenPRItem,
  PullRequestCiStatus,
} from "@src/api/tauri/github";
import type { SessionLaunchWorkItemContext } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { normalizePrStatus } from "@src/shared/pr/prStatus";

export const WORK_ITEM_PICKER_RESULT_LIMIT = 20;
const WORK_ITEM_CACHE_MAX_ITEMS = 500;

export type WorkItemPickerFilter =
  | "all"
  | "workitem"
  | "github_issue"
  | "github_pr";
export type WorkItemPickerOptionKind = Exclude<WorkItemPickerFilter, "all">;

export interface WorkItemPickerOption {
  key: string;
  kind: WorkItemPickerOptionKind;
  title: string;
  identifier: string;
  detail: string;
  searchableText: string;
  pillPath: string;
  pillName: string;
  prStatus?: string;
  ciStatus?: PullRequestCiStatus;
  contextText?: string;
  workItemContext?: Omit<SessionLaunchWorkItemContext, "metadata">;
}

let workspaceWorkItemRequest: Promise<WorkItemPickerOption[]> | null = null;

function formatTodoLines(
  todos: ReadonlyArray<{ status: string; content: string }>
): string {
  if (todos.length === 0) return "";
  return `\n## Todos\n${todos
    .map(
      (todo) => `- [${todo.status === "completed" ? "x" : " "}] ${todo.content}`
    )
    .join("\n")}`;
}

function formatWorkItemContext({
  shortId,
  title,
  status,
  priority,
  body,
  labels,
  todos,
}: {
  shortId: string;
  title: string;
  status: string;
  priority: string;
  body: string;
  labels: readonly string[];
  todos: ReadonlyArray<{ status: string; content: string }>;
}): string {
  const parts = [
    `[Work Item: ${shortId}]`,
    `Title: ${title}`,
    `Status: ${status}`,
    `Priority: ${priority}`,
  ];
  if (labels.length > 0) parts.push(`Labels: ${labels.join(", ")}`);
  if (body.trim()) parts.push(`\n## Description\n${body.trim()}`);
  parts.push(formatTodoLines(todos));
  return parts.filter(Boolean).join("\n");
}

function projectWorkItemOption(
  project: WorkspaceWorkItemsData["projectEntries"][number]["project"],
  item: EnrichedWorkItem
): WorkItemPickerOption {
  const path = `${project.slug}/${item.shortId}`;
  return {
    key: `workitem:${path}`,
    kind: "workitem",
    title: item.title,
    identifier: item.shortId,
    detail: `${project.meta.name} · ${item.status}`,
    searchableText: [
      item.shortId,
      item.title,
      item.status,
      item.priority,
      project.meta.name,
      ...item.labels.map((label) => label.name),
    ]
      .join(" ")
      .toLowerCase(),
    pillPath: path,
    pillName: `${item.shortId} ${item.title}`,
    contextText: formatWorkItemContext({
      shortId: item.shortId,
      title: item.title,
      status: item.status,
      priority: item.priority,
      body: item.body,
      labels: item.labels.map((label) => label.name),
      todos: item.todos,
    }),
    workItemContext: {
      orgId: project.meta.org_id,
      projectId: project.meta.id,
      projectName: project.meta.name,
      projectSlug: project.slug,
      workItemId: item.shortId,
      agentRole: "custom",
    },
  };
}

function standaloneWorkItemOption(item: WorkItemData): WorkItemPickerOption {
  const shortId = item.frontmatter.short_id || item.frontmatter.id;
  const path = `standalone/${shortId}`;
  return {
    key: `workitem:${path}`,
    kind: "workitem",
    title: item.frontmatter.title,
    identifier: shortId,
    detail: item.frontmatter.status,
    searchableText: [
      shortId,
      item.frontmatter.title,
      item.frontmatter.status,
      item.frontmatter.priority,
      ...item.frontmatter.labels,
    ]
      .join(" ")
      .toLowerCase(),
    pillPath: path,
    pillName: `${shortId} ${item.frontmatter.title}`,
    contextText: formatWorkItemContext({
      shortId,
      title: item.frontmatter.title,
      status: item.frontmatter.status,
      priority: item.frontmatter.priority,
      body: item.body,
      labels: item.frontmatter.labels,
      todos: item.frontmatter.todos,
    }),
    workItemContext: {
      workItemId: shortId,
      agentRole: "custom",
    },
  };
}

export function workspaceWorkItemsToPickerOptions(
  data: WorkspaceWorkItemsData
): WorkItemPickerOption[] {
  return [
    ...data.projectEntries.flatMap(({ project, workItems }) =>
      workItems.map((item) => projectWorkItemOption(project, item))
    ),
    ...data.standaloneWorkItems.map(standaloneWorkItemOption),
  ].slice(0, WORK_ITEM_CACHE_MAX_ITEMS);
}

export async function loadWorkspaceWorkItemOptions(): Promise<
  WorkItemPickerOption[]
> {
  if (workspaceWorkItemRequest) return workspaceWorkItemRequest;

  workspaceWorkItemRequest = projectApi
    .readWorkspaceWorkItemsData({ readBucket: "active" })
    .then(workspaceWorkItemsToPickerOptions)
    .finally(() => {
      workspaceWorkItemRequest = null;
    });
  return workspaceWorkItemRequest;
}

export function githubWorkItemsToPickerOptions({
  issues,
  prs,
  repoFullName,
}: {
  issues: readonly GitHubIssue[];
  prs: readonly OpenPRItem[];
  repoFullName: string | null;
}): WorkItemPickerOption[] {
  const repoName = repoFullName ?? "GitHub";
  return [
    ...issues.map((issue) => ({
      key: `github_issue:${issue.html_url}`,
      kind: "github_issue" as const,
      title: issue.title,
      identifier: `#${issue.number}`,
      detail: `${repoName} · ${issue.state}`,
      searchableText: [
        issue.number,
        issue.title,
        issue.state,
        repoName,
        ...issue.labels.map((label) => label.name),
      ]
        .join(" ")
        .toLowerCase(),
      pillPath: issue.html_url,
      pillName: `#${issue.number} ${issue.title}`,
    })),
    ...prs.map((pr) => {
      const prStatus = normalizePrStatus({
        state: pr.state,
        draft: pr.draft,
      });
      return {
        key: `github_pr:${pr.url}`,
        kind: "github_pr" as const,
        title: pr.title,
        identifier: `#${pr.number}`,
        detail: `${repoName} · ${prStatus}`,
        searchableText: [
          pr.number,
          pr.title,
          prStatus,
          pr.ci_status,
          repoName,
          pr.head_branch,
          pr.base_branch,
        ]
          .join(" ")
          .toLowerCase(),
        pillPath: pr.url,
        pillName: `#${pr.number} ${pr.title}`,
        prStatus,
        ciStatus: pr.ci_status,
      };
    }),
  ];
}

export function filterWorkItemPickerOptions(
  options: readonly WorkItemPickerOption[],
  filter: WorkItemPickerFilter,
  searchQuery: string,
  limit: number = WORK_ITEM_PICKER_RESULT_LIMIT
): WorkItemPickerOption[] {
  const query = searchQuery.trim().toLowerCase();
  return options
    .filter(
      (option) =>
        (filter === "all" || option.kind === filter) &&
        (!query || option.searchableText.includes(query))
    )
    .slice(0, limit);
}
