import { describe, expect, it } from "vitest";

import type { GitHubIssue, OpenPRItem } from "@src/api/tauri/github";

import { parseGitHubSearchQuery } from "./githubWorkItemsSearchQuery";
import type { GitHubRepoSource } from "./githubWorkItemsTypes";
import { deriveGitHubWorkItemsState } from "./useGitHubWorkItemsDerivedState";
import {
  EMPTY_REPO_ISSUES,
  EMPTY_REPO_PRS,
} from "./useGitHubWorkItemsLoadLifecycle";

const source: GitHubRepoSource = {
  repoId: "repo-1",
  repoPath: "/repo",
  label: "repo",
  remoteUrl: "https://github.com/acme/repo.git",
  repoFullName: "acme/repo",
  viewerLogin: "viewer",
};
const issue = {
  number: 42,
  title: "Fix crash",
  state: "open",
  updated_at: "2026-07-20T12:00:00.000Z",
  comments: 0,
  labels: [],
  assignees: [],
  user: { login: "author", avatar_url: "" },
} as unknown as GitHubIssue;
const mergedPr = {
  number: 7,
  url: "https://github.com/acme/repo/pull/7",
  title: "Ship fix",
  state: "merged",
  author_login: "author",
  author_avatar_url: null,
  requested_reviewer_logins: [],
  updated_at: "2026-07-20T11:00:00.000Z",
  head_branch: "fix/crash",
  base_branch: "main",
  draft: false,
  created_at: "2026-07-20T10:00:00.000Z",
} as OpenPRItem;

function derive(selectedRepo: string, selectedRepoPath: string | null) {
  return deriveGitHubWorkItemsState({
    repoSources: [source],
    repoIssueMap: {
      [source.repoFullName]: {
        ...EMPTY_REPO_ISSUES,
        openIssues: [issue],
        openLoaded: true,
        openHasMore: true,
        openNextPage: 2,
      },
    },
    repoPrMap: {
      [source.repoFullName]: {
        ...EMPTY_REPO_PRS,
        closedPrs: [mergedPr],
        closedLoaded: true,
      },
    },
    parsedSearchQuery: parseGitHubSearchQuery("state:all"),
    selectedRepo,
    selectedRepoPath,
    currentPage: 1,
    allReposValue: "all",
    currentWorkstationValue: "currentWorkstation",
  });
}

describe("GitHub work-items derived state", () => {
  it("resolves current workstation and invalid repo selections", () => {
    expect(derive("currentWorkstation", "/repo")).toMatchObject({
      effectiveSelectedRepo: "acme/repo",
      selectedRepoSourceForCreate: source,
    });
    expect(derive("missing/repo", null).effectiveSelectedRepo).toBe("all");
  });

  it("projects sorted items, state counts, and remote pagination", () => {
    const state = derive("all", "/repo");
    expect(state.allItems.map((item) => item.id)).toEqual([42, 7]);
    expect(state.issueStateCounts).toEqual({ open: 1, closed: 0 });
    expect(state.closedPrCount).toBe(1);
    expect(state.hasMoreFilteredIssues).toBe(true);
    expect(state.openIssuesLoaded).toBe(true);
    expect(state.closedIssuesLoaded).toBe(false);
  });

  it("orders open PRs with personal work before other todos", () => {
    const openPr = (
      number: number,
      authorLogin: string,
      requestedReviewerLogins: string[]
    ): OpenPRItem => ({
      ...mergedPr,
      number,
      state: "open",
      author_login: authorLogin,
      requested_reviewer_logins: requestedReviewerLogins,
    });
    const state = deriveGitHubWorkItemsState({
      repoSources: [source],
      repoIssueMap: {},
      repoPrMap: {
        [source.repoFullName]: {
          ...EMPTY_REPO_PRS,
          openPrs: [
            openPr(8, "teammate", ["viewer"]),
            openPr(9, "viewer", []),
            openPr(10, "teammate", []),
          ],
          openLoaded: true,
          closedPrs: [mergedPr],
          closedLoaded: true,
        },
      },
      parsedSearchQuery: parseGitHubSearchQuery("is:pr is:open"),
      selectedRepo: "all",
      selectedRepoPath: "/repo",
      currentPage: 1,
      allReposValue: "all",
      currentWorkstationValue: "currentWorkstation",
    });

    expect(state.filteredItems.map((item) => item.id)).toEqual([8, 9, 10]);
    expect(
      state.pullRequestTodoSections.reviewRequested.map((item) => item.id)
    ).toEqual([8]);
    expect(
      state.pullRequestTodoSections.authoredByViewer.map((item) => item.id)
    ).toEqual([9]);
    expect(
      state.pullRequestTodoSections.otherTodos.map((item) => item.id)
    ).toEqual([10]);
  });
});
