import { describe, expect, it } from "vitest";

import type { GitHubIssue } from "@src/api/tauri/github";

import { mapIssueToManagedItem } from "./githubManagedItemModel";
import type { GitHubRepoSource } from "./githubWorkItemsTypes";
import {
  type IssueDetailState,
  reconcileIssueDetailIssue,
} from "./useGitHubIssueDetail";

const source: GitHubRepoSource = {
  repoId: "repo-1",
  repoPath: "/workspace/ORG2",
  label: "ORG2",
  remoteUrl: "https://github.com/org2ai/ORG2.git",
  repoFullName: "org2ai/ORG2",
  viewerLogin: "viewer",
  permissions: {
    role_name: "write",
    can_manage_issues: true,
    can_manage_pull_requests: true,
  },
};

const issue: GitHubIssue = {
  number: 42,
  title: "Assign from issue detail",
  body: null,
  state: "open",
  state_reason: null,
  html_url: "https://github.com/org2ai/ORG2/issues/42",
  created_at: "2026-08-04T10:00:00.000Z",
  updated_at: "2026-08-04T11:00:00.000Z",
  closed_at: null,
  user: { login: "author", avatar_url: "" },
  labels: [],
  assignees: [],
  comments: 0,
  milestone: null,
};

function createDetail(): IssueDetailState {
  return {
    source: mapIssueToManagedItem(issue, source),
    issue,
    timeline: [],
    timelineLoading: false,
    submittingComment: false,
    error: "stale error",
  };
}

describe("reconcileIssueDetailIssue", () => {
  it("reconciles the open detail and its managed source from GitHub", () => {
    const updatedIssue: GitHubIssue = {
      ...issue,
      updated_at: "2026-08-04T12:00:00.000Z",
      assignees: [
        { login: "reviewer", avatar_url: "https://example.com/reviewer.png" },
      ],
    };

    const reconciled = reconcileIssueDetailIssue(createDetail(), updatedIssue);

    expect(reconciled?.issue).toBe(updatedIssue);
    expect(reconciled?.source.rawIssue).toBe(updatedIssue);
    expect(reconciled?.source.updatedAt).toBe(updatedIssue.updated_at);
    expect(reconciled?.error).toBeNull();
  });

  it("ignores a response for a different issue", () => {
    const current = createDetail();
    expect(
      reconcileIssueDetailIssue(current, {
        ...issue,
        number: 43,
        html_url: "https://github.com/org2ai/ORG2/issues/43",
      })
    ).toBe(current);
  });
});
