import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getGitRemotes } from "@src/api/http/git/remotes";
import { getGitHubViewerLogin, listPRsLocal } from "@src/api/tauri/github";
import type {
  GitHubIssue,
  OpenPRItem,
  PullRequestListState,
} from "@src/api/tauri/github";
import {
  coalesceGitHubListRequest,
  getCachedIssues,
  getCachedPrs,
  isIssueCacheStale,
  isPrCacheStale,
  setCachedPrs,
  updateCachedClosedIssues,
  updateCachedOpenIssues,
} from "@src/services/git/githubListCache";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";
import { fetchIssues } from "@src/services/git/operations/githubIssues";
import { REPO_KIND } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";
import { mapWithConcurrency } from "@src/util/collections/mapWithConcurrency";

import type {
  GitHubIssuePageState,
  GitHubQueryScope,
} from "./githubWorkItemsSearchQuery";
import {
  type GitHubRepoSource,
  getGitHubListCacheKey,
} from "./githubWorkItemsTypes";

export const ISSUE_PAGE_SIZE = 50;
const PR_PAGE_SIZE = 50;
const GITHUB_SOURCE_CONCURRENCY = 4;

export interface RepoIssueState {
  openIssues: GitHubIssue[];
  closedIssues: GitHubIssue[];
  openLoaded: boolean;
  closedLoaded: boolean;
  openHasMore: boolean;
  closedHasMore: boolean;
  openNextPage: number | null;
  closedNextPage: number | null;
}

export interface RepoPrState {
  openPrs: OpenPRItem[];
  closedPrs: OpenPRItem[];
  openLoaded: boolean;
  closedLoaded: boolean;
  openError: string | null;
  closedError: string | null;
}

interface RepoIssueLoadResult extends RepoIssueState {
  source: GitHubRepoSource;
  error: string | null;
}

interface RepoPrLoadResult {
  source: GitHubRepoSource;
  state: PullRequestListState;
  prs: OpenPRItem[];
  loaded: boolean;
  error: string | null;
}

export const EMPTY_REPO_ISSUES: RepoIssueState = {
  openIssues: [],
  closedIssues: [],
  openLoaded: false,
  closedLoaded: false,
  openHasMore: false,
  closedHasMore: false,
  openNextPage: null,
  closedNextPage: null,
};

export const EMPTY_REPO_PRS: RepoPrState = {
  openPrs: [],
  closedPrs: [],
  openLoaded: false,
  closedLoaded: false,
  openError: null,
  closedError: null,
};

export function getRepoIssueMapKey(source: GitHubRepoSource): string {
  return source.repoFullName;
}

export function mergeUniqueIssues(
  existingIssues: GitHubIssue[],
  incomingIssues: GitHubIssue[]
): GitHubIssue[] {
  const seenIssueNumbers = new Set(existingIssues.map((issue) => issue.number));
  return [
    ...existingIssues,
    ...incomingIssues.filter((issue) => !seenIssueNumbers.has(issue.number)),
  ];
}

function getCachedRepoIssues(source: GitHubRepoSource): RepoIssueState {
  const cached = getCachedIssues(getGitHubListCacheKey(source));
  if (!cached) return EMPTY_REPO_ISSUES;
  return {
    openIssues: cached.openIssues,
    closedIssues: cached.closedIssues,
    openLoaded: typeof cached.openCachedAt === "number",
    closedLoaded: typeof cached.closedCachedAt === "number",
    openHasMore: cached.openIssues.length >= ISSUE_PAGE_SIZE,
    closedHasMore: cached.closedIssues.length >= ISSUE_PAGE_SIZE,
    openNextPage: cached.openIssues.length >= ISSUE_PAGE_SIZE ? 2 : null,
    closedNextPage: cached.closedIssues.length >= ISSUE_PAGE_SIZE ? 2 : null,
  };
}

function getCachedRepoPrs(source: GitHubRepoSource): RepoPrState {
  const cacheKey = getGitHubListCacheKey(source);
  const open = getCachedPrs(cacheKey, "open");
  const closed = getCachedPrs(cacheKey, "closed");
  return {
    openPrs: open?.prs ?? [],
    closedPrs: closed?.prs ?? [],
    openLoaded: Boolean(open),
    closedLoaded: Boolean(closed),
    openError: null,
    closedError: null,
  };
}

async function resolveGitHubRepoSource(
  repo: Repo
): Promise<GitHubRepoSource | null> {
  if (repo.kind !== REPO_KIND.GIT || !repo.path) return null;
  let remoteUrl = repo.repo_url;
  if (!remoteUrl) {
    try {
      remoteUrl = (
        await getGitRemotes({ repo_id: repo.id, repo_path: repo.path })
      )?.remotes?.find((remote) => remote.name === "origin")?.url;
    } catch {
      return null;
    }
  }
  if (!remoteUrl) return null;
  const repoFullName = parseGithubRepoFullName(remoteUrl);
  if (!repoFullName) return null;
  return {
    repoId: repo.id,
    repoPath: repo.path,
    label: repo.name,
    remoteUrl,
    repoFullName,
    viewerLogin: null,
  };
}

async function loadRepoIssues(
  source: GitHubRepoSource,
  states: GitHubIssuePageState[],
  force: boolean
): Promise<RepoIssueLoadResult> {
  const cacheKey = getGitHubListCacheKey(source);
  const cached = getCachedRepoIssues(source);
  if (!force && states.every((state) => !isIssueCacheStale(cacheKey, state))) {
    return { source, ...cached, error: null };
  }
  const results = await coalesceGitHubListRequest(
    `work-management:issues:${states.join(",")}:${cacheKey}`,
    () =>
      Promise.all(
        states.map((state) =>
          fetchIssues(source.remoteUrl, {
            state,
            page: 1,
            perPage: ISSUE_PAGE_SIZE,
          })
        )
      )
  );
  const resultByState = new Map(
    states.map((state, index) => [state, results[index]] as const)
  );
  const openResult = resultByState.get("open");
  const closedResult = resultByState.get("closed");
  const openIssues = openResult?.data?.issues ?? cached.openIssues;
  const closedIssues = closedResult?.data?.issues ?? cached.closedIssues;
  if (openResult?.data) updateCachedOpenIssues(cacheKey, openIssues);
  if (closedResult?.data) updateCachedClosedIssues(cacheKey, closedIssues);
  return {
    source,
    openIssues,
    closedIssues,
    openLoaded: Boolean(openResult?.data) || cached.openLoaded,
    closedLoaded: Boolean(closedResult?.data) || cached.closedLoaded,
    openHasMore: openResult?.data?.has_more ?? cached.openHasMore,
    closedHasMore: closedResult?.data?.has_more ?? cached.closedHasMore,
    openNextPage: openResult?.data?.next_page ?? cached.openNextPage,
    closedNextPage: closedResult?.data?.next_page ?? cached.closedNextPage,
    error: openResult?.error ?? closedResult?.error ?? null,
  };
}

async function loadRepoPrs(
  source: GitHubRepoSource,
  state: PullRequestListState,
  force: boolean
): Promise<RepoPrLoadResult> {
  const cacheKey = getGitHubListCacheKey(source);
  const cached = getCachedPrs(cacheKey, state);
  if (cached && !force && !isPrCacheStale(cacheKey, state)) {
    return { source, state, prs: cached.prs, loaded: true, error: null };
  }
  try {
    const prs = await coalesceGitHubListRequest(
      `work-management:prs:${state}:${cacheKey}`,
      () => listPRsLocal(source.repoFullName, state, PR_PAGE_SIZE)
    );
    setCachedPrs(cacheKey, prs, state);
    return { source, state, prs, loaded: true, error: null };
  } catch (error: unknown) {
    return {
      source,
      state,
      prs: cached?.prs ?? [],
      loaded: Boolean(cached),
      error: String(error),
    };
  }
}

export function selectGitHubLoadSources({
  sources,
  selectedRepo,
  selectedRepoPath,
  allReposValue,
  currentWorkstationValue,
}: {
  sources: GitHubRepoSource[];
  selectedRepo: string;
  selectedRepoPath: string | null;
  allReposValue: string;
  currentWorkstationValue: string;
}): GitHubRepoSource[] {
  if (selectedRepo === allReposValue) return sources;
  if (selectedRepo === currentWorkstationValue) {
    const currentSource = sources.find(
      (source) => source.repoPath === selectedRepoPath
    );
    return currentSource ? [currentSource] : [];
  }
  const selectedSource = sources.find(
    (source) => source.repoFullName === selectedRepo
  );
  return selectedSource ? [selectedSource] : [];
}

export function useGitHubWorkItemsLoadLifecycle({
  repos,
  scope,
  issueStates,
  prStates,
  refreshNonce,
  selectedRepo = "__all__",
  selectedRepoPath = null,
  allReposValue = "__all__",
  currentWorkstationValue = "__current__",
}: {
  repos: Repo[];
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  issueStates: GitHubIssuePageState[];
  prStates: PullRequestListState[];
  refreshNonce: number;
  selectedRepo?: string;
  selectedRepoPath?: string | null;
  allReposValue?: string;
  currentWorkstationValue?: string;
}) {
  const [repoSources, setRepoSources] = useState<GitHubRepoSource[]>([]);
  const [repoIssueMap, setRepoIssueMap] = useState<
    Record<string, RepoIssueState>
  >({});
  const [repoPrMap, setRepoPrMap] = useState<Record<string, RepoPrState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const handledRefreshNonceRef = useRef(0);
  const gitRepos = useMemo(
    () => repos.filter((repo) => repo.kind === REPO_KIND.GIT && repo.path),
    [repos]
  );

  useEffect(() => {
    let cancelled = false;
    const forceRefresh = refreshNonce !== handledRefreshNonceRef.current;
    handledRefreshNonceRef.current = refreshNonce;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      if (gitRepos.length === 0) {
        setRepoSources([]);
        setRepoIssueMap({});
        setRepoPrMap({});
        setLoading(false);
        return;
      }
      const [viewerResult, sources] = await Promise.all([
        coalesceGitHubListRequest(
          "work-management:viewer-login",
          getGitHubViewerLogin
        ).then(
          (login) => ({ login, error: null }),
          (error: unknown) => ({ login: null, error: String(error) })
        ),
        mapWithConcurrency(
          gitRepos,
          GITHUB_SOURCE_CONCURRENCY,
          resolveGitHubRepoSource
        ),
      ]);
      if (cancelled) return;
      const viewerLoginError = viewerResult.error;
      const resolvedSources = sources
        .filter((source): source is GitHubRepoSource => Boolean(source))
        .map((source) => ({ ...source, viewerLogin: viewerResult.login }));
      if (cancelled) return;
      setRepoSources(resolvedSources);
      if (!viewerResult.login) {
        setRepoIssueMap({});
        setRepoPrMap({});
        setLoadError(
          viewerLoginError ?? "GitHub viewer identity is unavailable"
        );
        setLoading(false);
        return;
      }
      setRepoIssueMap(
        scope === "issue"
          ? Object.fromEntries(
              resolvedSources.map((source) => [
                getRepoIssueMapKey(source),
                getCachedRepoIssues(source),
              ])
            )
          : {}
      );
      setRepoPrMap(
        scope === "pr"
          ? Object.fromEntries(
              resolvedSources.map((source) => [
                getRepoIssueMapKey(source),
                getCachedRepoPrs(source),
              ])
            )
          : {}
      );
      if (resolvedSources.length === 0) {
        setLoading(false);
        return;
      }
      const sourcesToLoad = selectGitHubLoadSources({
        sources: resolvedSources,
        selectedRepo,
        selectedRepoPath,
        allReposValue,
        currentWorkstationValue,
      });
      const [issueResults, prResults] = await Promise.all([
        scope === "issue"
          ? mapWithConcurrency(
              sourcesToLoad,
              GITHUB_SOURCE_CONCURRENCY,
              (source) => loadRepoIssues(source, issueStates, forceRefresh)
            )
          : Promise.resolve([]),
        scope === "pr"
          ? mapWithConcurrency(
              sourcesToLoad.flatMap((source) =>
                prStates.map((state) => ({ source, state }))
              ),
              GITHUB_SOURCE_CONCURRENCY,
              ({ source, state }) => loadRepoPrs(source, state, forceRefresh)
            )
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      if (scope === "issue") {
        setRepoIssueMap(
          Object.fromEntries(
            issueResults.map(({ source, error: _error, ...state }) => [
              getRepoIssueMapKey(source),
              state,
            ])
          )
        );
      } else {
        setRepoPrMap((current) => {
          const next = { ...current };
          for (const result of prResults) {
            const key = getRepoIssueMapKey(result.source);
            const currentState = next[key] ?? EMPTY_REPO_PRS;
            next[key] =
              result.state === "open"
                ? {
                    ...currentState,
                    openPrs: result.prs,
                    openLoaded: result.loaded,
                    openError: result.error,
                  }
                : {
                    ...currentState,
                    closedPrs: result.prs,
                    closedLoaded: result.loaded,
                    closedError: result.error,
                  };
          }
          return next;
        });
      }
      setLoadError(
        viewerLoginError ??
          issueResults.find((result) => result.error)?.error ??
          prResults.find((result) => result.error)?.error ??
          null
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    allReposValue,
    currentWorkstationValue,
    gitRepos,
    issueStates,
    prStates,
    refreshNonce,
    scope,
    selectedRepo,
    selectedRepoPath,
  ]);

  const updateIssueMap = useCallback(
    (
      update: (
        current: Record<string, RepoIssueState>
      ) => Record<string, RepoIssueState>
    ) => setRepoIssueMap(update),
    []
  );
  const updatePrMap = useCallback(
    (
      update: (
        current: Record<string, RepoPrState>
      ) => Record<string, RepoPrState>
    ) => setRepoPrMap(update),
    []
  );
  const setListError = useCallback((error: string | null) => {
    setLoadError(error);
  }, []);

  return {
    repoSources,
    repoIssueMap,
    repoPrMap,
    loading,
    loadError,
    updateIssueMap,
    updatePrMap,
    setListError,
  };
}
