import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EnrichedWorkItem,
  WorkspaceWorkItemsData,
} from "@src/api/http/project";
import type { OpenPRItem } from "@src/api/tauri/github";

import {
  type WorkItemPickerOption,
  filterWorkItemPickerOptions,
  githubWorkItemsToPickerOptions,
  loadWorkspaceWorkItemOptions,
  workspaceWorkItemsToPickerOptions,
} from "./workItemPickerModel";

const projectApiMocks = vi.hoisted(() => ({
  readWorkspaceWorkItemsData: vi.fn(),
}));

vi.mock("@src/api/http/project", () => ({
  projectApi: projectApiMocks,
}));

function enrichedWorkItem(index: number): EnrichedWorkItem {
  return {
    shortId: `WI-${index}`,
    title: `Work item ${index}`,
    status: "planned",
    priority: "medium",
    body: "",
    labels: [],
    todos: [],
  } as unknown as EnrichedWorkItem;
}

function pickerOption(
  index: number,
  kind: WorkItemPickerOption["kind"] = "workitem"
): WorkItemPickerOption {
  return {
    key: `${kind}:${index}`,
    kind,
    title: index === 2 ? "Fix login" : `Item ${index}`,
    identifier: `#${index}`,
    detail: "open",
    searchableText: index === 2 ? "fix login open" : `item ${index} open`,
    pillPath: `${kind}/${index}`,
    pillName: `Item ${index}`,
  };
}

describe("work item picker model", () => {
  beforeEach(() => {
    projectApiMocks.readWorkspaceWorkItemsData.mockReset();
  });

  it("bounds the retained workspace snapshot", () => {
    const data = {
      projectEntries: [
        {
          project: {
            slug: "project",
            meta: { id: "project-id", name: "Project", org_id: "org-id" },
          },
          workItems: Array.from({ length: 501 }, (_, index) =>
            enrichedWorkItem(index)
          ),
        },
      ],
      standaloneWorkItems: [],
      orgs: [],
    } as unknown as WorkspaceWorkItemsData;

    expect(workspaceWorkItemsToPickerOptions(data)).toHaveLength(500);
  });

  it("filters by source and query before applying the render cap", () => {
    const options = [
      ...Array.from({ length: 25 }, (_, index) => pickerOption(index)),
      pickerOption(2, "github_issue"),
    ];

    expect(filterWorkItemPickerOptions(options, "all", "")).toHaveLength(20);
    expect(
      filterWorkItemPickerOptions(options, "github_issue", "login").map(
        (option) => option.key
      )
    ).toEqual(["github_issue:2"]);
  });

  it("preserves GitHub PR type and check status for presentation", () => {
    const [option] = githubWorkItemsToPickerOptions({
      issues: [],
      prs: [
        {
          number: 42,
          title: "Draft fix",
          state: "open",
          draft: true,
          ci_status: "failure",
          author_login: "octocat",
          url: "https://github.com/acme/repo/pull/42",
          head_branch: "fix",
          base_branch: "main",
        } as OpenPRItem,
      ],
      repoFullName: "acme/repo",
    });

    expect(option).toMatchObject({
      kind: "github_pr",
      prStatus: "draft",
      ciStatus: "failure",
      detail: "acme/repo",
      openedBy: "octocat",
      statusLabel: "draft",
    });
  });

  it("shares concurrent workspace reads", async () => {
    let resolveRead: ((data: WorkspaceWorkItemsData) => void) | undefined;
    projectApiMocks.readWorkspaceWorkItemsData.mockReturnValue(
      new Promise<WorkspaceWorkItemsData>((resolve) => {
        resolveRead = resolve;
      })
    );

    const first = loadWorkspaceWorkItemOptions();
    const second = loadWorkspaceWorkItemOptions();
    expect(projectApiMocks.readWorkspaceWorkItemsData).toHaveBeenCalledOnce();

    resolveRead?.({
      projectEntries: [],
      standaloneWorkItems: [],
      orgs: [],
    });
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
  });
});
