// @vitest-environment jsdom
import React, { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { WorkItem } from "@src/types/core/workItem";

import type { ManagedPrItem } from "../../WorkManagement/githubManagedItemModel";
import TeamInboxView from "../TeamInboxView";
import type { AssignedWorkItem } from "../domain";

const splitViewProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const componentProps = vi.hoisted(() => ({
  assignedDetail: null as Record<string, unknown> | null,
  list: null as Record<string, unknown> | null,
  placeholder: null as Record<string, unknown> | null,
  prDetail: null as Record<string, unknown> | null,
}));
const translate = vi.hoisted(() => vi.fn((key: string) => key));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock("@src/modules/shared/layouts/SplitViewLayout", () => ({
  default: (props: Record<string, unknown>) => {
    splitViewProps.current = props;
    return createElement(
      "div",
      { "data-testid": "team-inbox-split" },
      props.listContent as React.ReactNode,
      props.mainContent as React.ReactNode
    );
  },
}));

vi.mock("@src/modules/shared/layouts/blocks", () => ({
  LoadingBar: () => createElement("div", { "data-testid": "loading-bar" }),
  Placeholder: (props: Record<string, unknown>) => {
    componentProps.placeholder = props;
    return null;
  },
}));

vi.mock("../components", () => ({
  AssignedWorkItemDetail: (props: Record<string, unknown>) => {
    componentProps.assignedDetail = props;
    return null;
  },
  CommentMentionDetail: () => null,
  TeamInboxList: (props: Record<string, unknown>) => {
    componentProps.list = props;
    return null;
  },
}));

vi.mock(
  "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel",
  () => ({
    PrDetailPanel: (props: Record<string, unknown>) => {
      componentProps.prDetail = props;
      return null;
    },
  })
);

function createPullRequest(): ManagedPrItem {
  return {
    kind: "pr",
    id: 42,
    title: "Render in Team Inbox detail",
    repo: "orgii/desktop",
    repoId: "repo-1",
    repoPath: "/repos/orgii",
    remoteUrl: "https://github.com/orgii/desktop.git",
    viewerLogin: "viewer",
    rawPr: {
      number: 42,
      url: "https://github.com/orgii/desktop/pull/42",
      title: "Render in Team Inbox detail",
      state: "open",
      author_login: "viewer",
      author_avatar_url: null,
      requested_reviewer_logins: [],
      head_branch: "feat/team-inbox",
      base_branch: "main",
      draft: false,
      created_at: "2026-07-28T00:00:00.000Z",
      updated_at: "2026-07-28T00:05:00.000Z",
    },
    author: "viewer",
    authoredByViewer: true,
    reviewRequestedFromViewer: false,
    timeAgo: "5h",
    state: "open",
    sourceBranch: "feat/team-inbox",
    targetBranch: "main",
    updatedAt: "2026-07-28T00:05:00.000Z",
  };
}

const partialLoadItem: AssignedWorkItem = {
  id: "partial-load-item",
  kind: "assigned_work_item",
  occurredAt: "2026-08-05T00:00:00.000Z",
  readAt: null,
  actor: { id: "member-1", displayName: "Yuki" },
  target: {
    kind: "work_item",
    projectId: "demo",
    workItemId: "AAA-0001",
  },
  payload: {
    title: "Available work item",
    status: "todo",
    priority: "medium",
    assigneeMemberId: "member-1",
    assigneeName: "Yuki",
    updatedAt: "2026-08-05T00:00:00.000Z",
  },
};

describe("TeamInboxView split layout", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    splitViewProps.current = null;
    componentProps.assignedDetail = null;
    componentProps.list = null;
    componentProps.placeholder = null;
    componentProps.prDetail = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("does not leak the global Code Editor breadcrumb into Team Inbox", () => {
    act(() => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: {
            listPage: () => new Promise<never>(() => undefined),
          },
        })
      );
    });

    expect(splitViewProps.current?.alwaysShowBreadcrumb).toBeUndefined();
    expect(splitViewProps.current?.hideBreadcrumbWhenSidebarCollapsed).toBe(
      true
    );
    expect(splitViewProps.current?.listPanelBackgroundClassName).toBe(
      "bg-chat-pane"
    );
    expect(splitViewProps.current?.mainContentClassName).toBe("bg-chat-pane");
    expect(splitViewProps.current?.listWidth).toBe(360);
    expect(splitViewProps.current?.minListWidth).toBe(280);
    expect(splitViewProps.current?.maxListWidth).toBe(480);
    expect(componentProps.list?.loading).toBe(true);
  });

  it("allows the partial-load notice to be closed", async () => {
    await act(async () => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: {
            listPage: async () => ({
              items: [partialLoadItem],
              nextCursor: null,
              issue: { code: "partial_load" as const },
            }),
          },
        })
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="team-inbox-load-notice"]')
    ).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="common:actions.close"]'
        )
        ?.click();
    });

    expect(
      container.querySelector('[data-testid="team-inbox-load-notice"]')
    ).toBeNull();
  });

  it("automatically closes the partial-load notice after three seconds", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(
          createElement(TeamInboxView, {
            dataSource: {
              listPage: async () => ({
                items: [partialLoadItem],
                nextCursor: null,
                issue: { code: "partial_load" as const },
              }),
            },
          })
        );
        await Promise.resolve();
      });

      expect(
        container.querySelector('[data-testid="team-inbox-load-notice"]')
      ).not.toBeNull();

      act(() => vi.advanceTimersByTime(3000));

      expect(
        container.querySelector('[data-testid="team-inbox-load-notice"]')
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("projects successful detail edits back into the matching Inbox row", async () => {
    const assignedItem: AssignedWorkItem = {
      id: "assigned-1",
      kind: "assigned_work_item",
      occurredAt: "2026-07-28T00:00:00.000Z",
      readAt: "2026-07-28T00:01:00.000Z",
      actor: { id: "member-1", displayName: "Yuki" },
      target: {
        kind: "work_item",
        projectId: "demo",
        workItemId: "AAA-0001",
      },
      payload: {
        title: "Old title",
        status: "todo",
        priority: "medium",
        assigneeMemberId: "member-1",
        assigneeName: "Yuki",
        summary: "Old summary",
        updatedAt: "2026-07-28T00:00:00.000Z",
      },
    };

    await act(async () => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: {
            listPage: async () => ({
              items: [assignedItem],
              nextCursor: null,
            }),
          },
        })
      );
      await Promise.resolve();
    });

    act(() => {
      const onSelectItem = componentProps.list?.onSelectItem as
        | ((item: AssignedWorkItem) => void)
        | undefined;
      onSelectItem?.(assignedItem);
    });

    const onWorkItemUpdated = componentProps.assignedDetail
      ?.onWorkItemUpdated as ((workItem: WorkItem) => void) | undefined;
    expect(onWorkItemUpdated).toBeTypeOf("function");

    const updatedWorkItem: WorkItem = {
      session_id: "AAA-0001",
      user_id: "member-1",
      name: "Updated title",
      status: "in_review",
      workItemStatus: "in_review",
      priority: "high",
      spec: "## Updated summary",
      assignee: { id: "member-1", name: "Yuki" },
      star: false,
      target_date: null,
      created_time: "2026-07-28T00:00:00.000Z",
      updated_time: "2026-07-28T00:05:00.000Z",
      linkedSessions: [],
      todos: [],
    };

    act(() => onWorkItemUpdated?.(updatedWorkItem));

    const updatedItems = componentProps.list?.items as AssignedWorkItem[];
    expect(updatedItems[0].payload).toMatchObject({
      title: "Updated title",
      status: "in_review",
      priority: "high",
      assigneeMemberId: "member-1",
      assigneeName: "Yuki",
      summary: "## Updated summary",
      updatedAt: "2026-07-28T00:05:00.000Z",
    });

    act(() =>
      onWorkItemUpdated?.({
        ...updatedWorkItem,
        assignee: { id: "member-2", name: "Lin" },
      })
    );

    expect(componentProps.list?.items).toEqual([]);
  });

  it("opens a selected pull request in the Team Inbox right pane", async () => {
    const pullRequest = createPullRequest();

    await act(async () => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: {
            listPage: async () => ({ items: [], nextCursor: null }),
          },
          pullRequests: [pullRequest],
        })
      );
      await Promise.resolve();
    });

    const onSelectPullRequest = componentProps.list?.onSelectPullRequest as
      | ((pullRequest: ManagedPrItem) => void)
      | undefined;
    expect(onSelectPullRequest).toBeTypeOf("function");

    await act(async () => {
      onSelectPullRequest?.(pullRequest);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(componentProps.list?.selectedPullRequestKey).toBe(
      "orgii/desktop#42"
    );
    expect(componentProps.prDetail).toMatchObject({
      repoPath: "/repos/orgii",
      repoId: "repo-1",
      identity: {
        number: 42,
        title: "Render in Team Inbox detail",
        url: "https://github.com/orgii/desktop/pull/42",
        status: "open",
        headBranch: "feat/team-inbox",
        baseBranch: "main",
      },
    });
  });

  it("marks an unread item as read when its detail becomes visible", async () => {
    const unreadItem: AssignedWorkItem = {
      id: "assigned-unread",
      kind: "assigned_work_item",
      occurredAt: "2026-07-28T00:00:00.000Z",
      readAt: null,
      actor: { id: "member-1", displayName: "Yuki" },
      target: {
        kind: "work_item",
        projectId: "demo",
        workItemId: "AAA-0002",
      },
      payload: {
        title: "Unread item",
        status: "todo",
        priority: "none",
        assigneeMemberId: "member-1",
        assigneeName: "Yuki",
        updatedAt: "2026-07-28T00:00:00.000Z",
      },
    };
    let resolveMarkRead: (() => void) | undefined;
    const markRead = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveMarkRead = resolve;
        })
    );

    await act(async () => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: {
            listPage: async () => ({
              items: [unreadItem],
              nextCursor: null,
            }),
            markRead,
          },
        })
      );
      await Promise.resolve();
    });

    expect(markRead).not.toHaveBeenCalled();

    await act(async () => {
      const onSelectItem = componentProps.list?.onSelectItem as
        | ((item: AssignedWorkItem) => void)
        | undefined;
      onSelectItem?.(unreadItem);
      await Promise.resolve();
    });
    expect(markRead).toHaveBeenCalledOnce();
    expect(markRead).toHaveBeenCalledWith(unreadItem);

    await act(async () => {
      resolveMarkRead?.();
      await Promise.resolve();
    });
  });

  it("focuses and reads only the item explicitly requested by a notification", async () => {
    const firstItem: AssignedWorkItem = {
      id: "first",
      kind: "assigned_work_item",
      occurredAt: "2026-07-28T00:01:00.000Z",
      readAt: null,
      actor: { id: "member-1", displayName: "Yuki" },
      target: {
        kind: "work_item",
        projectId: "demo",
        workItemId: "AAA-0001",
      },
      payload: {
        title: "First item",
        status: "todo",
        priority: "medium",
        assigneeMemberId: "viewer",
        updatedAt: "2026-07-28T00:01:00.000Z",
      },
    };
    const requestedItem: AssignedWorkItem = {
      ...firstItem,
      id: "requested",
      target: { ...firstItem.target, workItemId: "AAA-0002" },
      payload: { ...firstItem.payload, title: "Requested item" },
    };
    const markRead = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: {
            listPage: async () => ({
              items: [firstItem, requestedItem],
              nextCursor: null,
            }),
            markRead,
          },
          focusRequest: {
            itemKey: "assigned_work_item:requested",
            requestId: 1,
          },
        })
      );
      await Promise.resolve();
    });

    expect(markRead).toHaveBeenCalledOnce();
    expect(markRead).toHaveBeenCalledWith(requestedItem);
    expect(componentProps.assignedDetail?.item).toEqual(requestedItem);
  });

  it("retries the backing source instead of rereading a failed snapshot", async () => {
    const listPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const refresh = vi.fn(async () => undefined);
    const refreshPullRequests = vi.fn();

    await act(async () => {
      root.render(
        createElement(TeamInboxView, {
          dataSource: { listPage, refresh },
          onRefreshPullRequests: refreshPullRequests,
        })
      );
      await Promise.resolve();
    });

    const action = componentProps.placeholder?.action as
      | { onClick?: () => void }
      | undefined;
    expect(action?.onClick).toBeTypeOf("function");

    await act(async () => {
      action?.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshPullRequests).toHaveBeenCalledOnce();
    expect(listPage).toHaveBeenCalledTimes(2);
  });
});
