import { useCallback } from "react";

import {
  type GitHubIssue,
  type OpenPRItem,
  updatePRStateLocal,
} from "@src/api/tauri/github";
import Message from "@src/components/Message";
import {
  setCachedPrs,
  updateCachedClosedIssues,
  updateCachedOpenIssues,
} from "@src/services/git/githubListCache";
import {
  closeIssue,
  reopenIssue,
} from "@src/services/git/operations/githubIssues";

import type { ManagedIssueItem, ManagedPrItem } from "./githubManagedItemModel";
import {
  type GitHubRepoSource,
  getGitHubListCacheKey,
} from "./githubWorkItemsTypes";
import {
  EMPTY_REPO_ISSUES,
  EMPTY_REPO_PRS,
  type RepoIssueState,
  type RepoPrState,
  getRepoIssueMapKey,
} from "./useGitHubWorkItemsLoadLifecycle";

export type ManagedIssueStatusValue =
  | "open"
  | "closed_completed"
  | "closed_not_planned";
export type ManagedPrStatusValue = "open" | "closed";

type UpdateIssueMap = (
  update: (
    current: Record<string, RepoIssueState>
  ) => Record<string, RepoIssueState>
) => void;
type UpdatePrMap = (
  update: (current: Record<string, RepoPrState>) => Record<string, RepoPrState>
) => void;

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

function findSource(
  sources: GitHubRepoSource[],
  repoFullName: string,
  repoPath: string
): GitHubRepoSource | undefined {
  return sources.find(
    (source) =>
      source.repoFullName === repoFullName && source.repoPath === repoPath
  );
}

export function useGitHubWorkItemStatusMutations({
  repoSources,
  updateIssueMap,
  updatePrMap,
  setListError,
  updateErrorMessage,
}: {
  repoSources: GitHubRepoSource[];
  updateIssueMap: UpdateIssueMap;
  updatePrMap: UpdatePrMap;
  setListError: (error: string | null) => void;
  updateErrorMessage: string;
}) {
  const updateIssueStatus = useCallback(
    async (item: ManagedIssueItem, value: ManagedIssueStatusValue) => {
      if (
        (value === "open" && item.state === "open") ||
        (value === "closed_completed" &&
          item.state === "closed" &&
          item.rawIssue.state_reason !== "not_planned") ||
        (value === "closed_not_planned" &&
          item.state === "closed" &&
          item.rawIssue.state_reason === "not_planned")
      ) {
        return;
      }
      const source = findSource(repoSources, item.repo, item.repoPath);
      if (!source) return;
      const result =
        value === "open"
          ? await reopenIssue({
              remoteUrl: source.remoteUrl,
              issueNumber: item.id,
            })
          : await closeIssue({
              remoteUrl: source.remoteUrl,
              issueNumber: item.id,
              reason:
                value === "closed_not_planned" ? "not_planned" : "completed",
            });
      if (!result.data) {
        const error = result.error ?? updateErrorMessage;
        setListError(error);
        Message.error(error);
        return;
      }
      updateIssueMap((current) => {
        const key = getRepoIssueMapKey(source);
        const nextState = replaceIssueInRepoState(
          current[key] ?? EMPTY_REPO_ISSUES,
          result.data
        );
        const cacheKey = getGitHubListCacheKey(source);
        if (nextState.openLoaded) {
          updateCachedOpenIssues(cacheKey, nextState.openIssues);
        }
        if (nextState.closedLoaded) {
          updateCachedClosedIssues(cacheKey, nextState.closedIssues);
        }
        return { ...current, [key]: nextState };
      });
      setListError(null);
    },
    [repoSources, setListError, updateErrorMessage, updateIssueMap]
  );

  const updatePrStatus = useCallback(
    async (item: ManagedPrItem, value: ManagedPrStatusValue) => {
      const source = findSource(repoSources, item.repo, item.repoPath);
      if (!source || item.state === "merged" || item.state === value) return;
      try {
        const pullRequest = await updatePRStateLocal(item.repo, item.id, value);
        updatePrMap((current) => {
          const key = getRepoIssueMapKey(source);
          const nextState = replacePrInRepoState(
            current[key] ?? EMPTY_REPO_PRS,
            pullRequest
          );
          const cacheKey = getGitHubListCacheKey(source);
          if (nextState.openLoaded) {
            setCachedPrs(cacheKey, nextState.openPrs, "open");
          }
          if (nextState.closedLoaded) {
            setCachedPrs(cacheKey, nextState.closedPrs, "closed");
          }
          return { ...current, [key]: nextState };
        });
        setListError(null);
      } catch (error: unknown) {
        const message = String(error) || updateErrorMessage;
        setListError(message);
        Message.error(message);
      }
    },
    [repoSources, setListError, updateErrorMessage, updatePrMap]
  );

  return { updateIssueStatus, updatePrStatus };
}
