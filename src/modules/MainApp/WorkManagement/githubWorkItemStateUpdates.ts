import type { GitHubIssue, OpenPRItem } from "@src/api/tauri/github";

import type {
  RepoIssueState,
  RepoPrState,
} from "./useGitHubWorkItemsLoadLifecycle";

function withoutNumber<T extends { number: number }>(
  items: T[],
  number: number
): T[] {
  return items.filter((item) => item.number !== number);
}

export function replaceIssueInRepoState(
  state: RepoIssueState,
  issue: GitHubIssue
): RepoIssueState {
  const openIssues = withoutNumber(state.openIssues, issue.number);
  const closedIssues = withoutNumber(state.closedIssues, issue.number);
  if (issue.state === "open") openIssues.unshift(issue);
  else closedIssues.unshift(issue);
  return { ...state, openIssues, closedIssues };
}

export function replacePrInRepoState(
  state: RepoPrState,
  pullRequest: OpenPRItem
): RepoPrState {
  const openPrs = withoutNumber(state.openPrs, pullRequest.number);
  const closedPrs = withoutNumber(state.closedPrs, pullRequest.number);
  if (pullRequest.state === "open") openPrs.unshift(pullRequest);
  else closedPrs.unshift(pullRequest);
  return { ...state, openPrs, closedPrs };
}
