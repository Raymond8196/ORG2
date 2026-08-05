import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GitHubIssue } from "@src/api/tauri/github";

import GitHubIssueThreadSurface, {
  mapGitHubIssueToThreadWorkItem,
} from "./GitHubIssueThreadSurface";
import { toggleExternalAssigneeIds } from "./WorkItemProperties/AssigneePropertyField";

vi.mock("@src/components/IntegrationIcon", () => ({
  default: ({ type }: { type: string }) =>
    React.createElement("span", { "data-integration-icon": type }),
}));

const issue: GitHubIssue = {
  id: 100_042,
  number: 42,
  title: "Use one issue detail surface",
  body: "Share the Inbox thread composition.",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/org2AI/ORG2/issues/42",
  created_at: "2026-08-04T10:00:00.000Z",
  updated_at: "2026-08-04T11:00:00.000Z",
  closed_at: null,
  user: {
    login: "octocat",
    avatar_url: "https://example.com/octocat.png",
  },
  labels: [
    {
      id: 7,
      name: "ui",
      color: "1d76db",
      description: null,
    },
  ],
  assignees: [
    {
      login: "reviewer",
      avatar_url: "https://example.com/reviewer.png",
    },
  ],
  comments: 1,
  milestone: "v1",
};

describe("mapGitHubIssueToThreadWorkItem", () => {
  it("preserves GitHub identity and metadata for the canonical thread", () => {
    expect(mapGitHubIssueToThreadWorkItem(issue)).toMatchObject({
      session_id: issue.html_url,
      shortId: "#42",
      name: issue.title,
      spec: issue.body,
      status: "open",
      workItemStatus: "open",
      project: {
        id: "org2AI/ORG2",
        name: "ORG2 issues",
      },
      createdBy: {
        id: "octocat",
        name: "octocat",
        avatar: "https://example.com/octocat.png",
      },
      assignee: {
        id: "reviewer",
        name: "reviewer",
        avatar: "https://example.com/reviewer.png",
      },
      labels: [{ id: "7", name: "ui", color: "#1d76db" }],
      milestone: { id: "v1", name: "v1" },
    });
  });

  it("keeps the thread usable when the issue URL has no repository path", () => {
    expect(
      mapGitHubIssueToThreadWorkItem({
        ...issue,
        html_url: "not-a-url",
        assignees: [],
        milestone: null,
      })
    ).toMatchObject({
      project: undefined,
      assignee: undefined,
      milestone: undefined,
    });
  });

  it("renders the external GitHub assignee control as editable", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GitHubIssueThreadSurface, {
        issue,
        timeline: [],
        timelineLoading: false,
        onStatusChange: vi.fn(),
        assigneeConfig: {
          currentAssigneeIds: ["reviewer"],
          options: [
            {
              id: "reviewer",
              label: "reviewer",
              avatar: "https://example.com/reviewer.png",
            },
          ],
          onChangeAssigneeIds: vi.fn(),
        },
      })
    );
    const assigneeStart = markup.indexOf(
      `data-testid="work-item-property-assignee-${issue.html_url}"`
    );
    const assigneeButton = markup.slice(
      assigneeStart,
      markup.indexOf("</button>", assigneeStart)
    );

    expect(assigneeStart).toBeGreaterThan(-1);
    expect(assigneeButton).toContain("reviewer");
    expect(assigneeButton).toContain("https://example.com/reviewer.png");
    expect(assigneeButton).not.toContain("disabled");
  });

  it("toggles external assignees without duplicating login casing", () => {
    expect(toggleExternalAssigneeIds(["Ada", "Grace"], "ada")).toEqual([
      "Grace",
    ]);
    expect(toggleExternalAssigneeIds(["Ada"], "Linus")).toEqual([
      "Ada",
      "Linus",
    ]);
  });
});
