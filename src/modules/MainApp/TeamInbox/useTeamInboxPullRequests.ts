import { atom, useAtom, useAtomValue } from "jotai";
import isEqual from "lodash/isEqual";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PullRequestListState } from "@src/api/tauri/github";
import { sidebarActiveCloudOrgIdAtom } from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { org2CloudRepoScopesAtom } from "@src/features/Org2Cloud/org2CloudSyncAtoms";
import {
  type OrgScopeFilterRepo,
  repoMatchesOrgScopes,
} from "@src/features/TeamCollaboration/orgScopeRepoFilter";
import { useShareableScopeKeyVersion } from "@src/features/TeamCollaboration/repoScopeResolver";
import {
  type ManagedPrItem,
  mapPrToManagedItem,
} from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";
import { GITHUB_QUERY_SCOPE } from "@src/modules/MainApp/WorkManagement/githubWorkItemsSearchQuery";
import type { GitHubIssuePageState } from "@src/modules/MainApp/WorkManagement/githubWorkItemsSearchQuery";
import {
  EMPTY_REPO_PRS,
  getRepoIssueMapKey,
  useGitHubWorkItemsLoadLifecycle,
} from "@src/modules/MainApp/WorkManagement/useGitHubWorkItemsLoadLifecycle";
import { type Repo, reposAtom } from "@src/store/repo";

const OPEN_PR_STATES: PullRequestListState[] = ["open"];
const NO_ISSUE_STATES: GitHubIssuePageState[] = [];
const MAX_RETAINED_TEAM_INBOX_PULL_REQUESTS = 500;

export interface TeamInboxPullRequestsState {
  items: ManagedPrItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export interface TeamInboxPullRequestsSnapshot {
  scopeKey: string | null;
  items: ManagedPrItem[];
  error: string | null;
  loaded: boolean;
}

const EMPTY_TEAM_INBOX_PULL_REQUESTS_SNAPSHOT: TeamInboxPullRequestsSnapshot = {
  scopeKey: null,
  items: [],
  error: null,
  loaded: false,
};

// Store-local and bounded: survives an Inbox surface remount without leaking
// GitHub rows across app stores or retaining every repository ever opened.
const teamInboxPullRequestsSnapshotAtom = atom<TeamInboxPullRequestsSnapshot>(
  EMPTY_TEAM_INBOX_PULL_REQUESTS_SNAPSHOT
);

function samePullRequestItems(
  left: readonly ManagedPrItem[],
  right: readonly ManagedPrItem[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    const { timeAgo: _leftTimeAgo, ...leftData } = item;
    const { timeAgo: _rightTimeAgo, ...rightData } = candidate;
    return isEqual(leftData, rightData);
  });
}

export function retainTeamInboxPullRequestsSnapshot({
  current,
  scopeKey,
  items,
  error,
  loading,
}: {
  current: TeamInboxPullRequestsSnapshot;
  scopeKey: string;
  items: ManagedPrItem[];
  error: string | null;
  loading: boolean;
}): TeamInboxPullRequestsSnapshot {
  const boundedItems = items.slice(0, MAX_RETAINED_TEAM_INBOX_PULL_REQUESTS);
  const sameScope = current.scopeKey === scopeKey;
  const itemsUnchanged =
    sameScope && samePullRequestItems(current.items, boundedItems);
  const loaded = boundedItems.length > 0 || !loading;
  if (itemsUnchanged && current.error === error && current.loaded === loaded) {
    return current;
  }
  return {
    scopeKey,
    items: itemsUnchanged ? current.items : boundedItems,
    error,
    loaded,
  };
}

type TeamInboxRepoScopeMatcher = (
  repo: OrgScopeFilterRepo,
  orgScopes: string[]
) => boolean;

export function selectTeamInboxPullRequestRepos(
  repos: Repo[],
  activeCloudOrgId: string | null,
  scopesByOrg: Readonly<Record<string, string[]>>,
  matchesOrgScopes: TeamInboxRepoScopeMatcher = repoMatchesOrgScopes
): Repo[] {
  if (!activeCloudOrgId) return repos;
  const orgScopes = scopesByOrg[activeCloudOrgId] ?? [];
  if (orgScopes.length === 0) return [];
  return repos.filter((repo) =>
    matchesOrgScopes(
      {
        repo_url: repo.repo_url,
        fs_uri: repo.fs_uri ?? repo.path,
      },
      orgScopes
    )
  );
}

export function useTeamInboxPullRequests(): TeamInboxPullRequestsState {
  const repos = useAtomValue(reposAtom);
  const activeCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const scopesByOrg = useAtomValue(org2CloudRepoScopesAtom);
  const scopeKeyVersion = useShareableScopeKeyVersion();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const scopedRepos = useMemo(() => {
    void scopeKeyVersion;
    return selectTeamInboxPullRequestRepos(
      repos,
      activeCloudOrgId,
      scopesByOrg
    );
  }, [activeCloudOrgId, repos, scopeKeyVersion, scopesByOrg]);
  const scopedRepoIds = useMemo(
    () => new Set(scopedRepos.map((repo) => repo.id)),
    [scopedRepos]
  );
  const scopeKey = useMemo(
    () =>
      [
        activeCloudOrgId ?? "local",
        ...scopedRepos
          .map(
            (repo) =>
              `${repo.id}:${repo.repo_url ?? repo.fs_uri ?? repo.path ?? ""}`
          )
          .sort(),
      ].join("|"),
    [activeCloudOrgId, scopedRepos]
  );
  const [retainedSnapshot, setRetainedSnapshot] = useAtom(
    teamInboxPullRequestsSnapshotAtom
  );
  const { repoSources, repoPrMap, loading, loadError } =
    useGitHubWorkItemsLoadLifecycle({
      repos: scopedRepos,
      scope: GITHUB_QUERY_SCOPE.PR,
      issueStates: NO_ISSUE_STATES,
      prStates: OPEN_PR_STATES,
      refreshNonce,
    });
  const items = useMemo(
    () =>
      repoSources
        .filter((source) => scopedRepoIds.has(source.repoId))
        .flatMap((source) => {
          const state = repoPrMap[getRepoIssueMapKey(source)] ?? EMPTY_REPO_PRS;
          return state.openPrs.map((pr) => mapPrToManagedItem(pr, source));
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [repoPrMap, repoSources, scopedRepoIds]
  );
  useEffect(() => {
    if (loading && items.length === 0) return;
    setRetainedSnapshot((current) =>
      retainTeamInboxPullRequestsSnapshot({
        current,
        scopeKey,
        items,
        error: loadError,
        loading,
      })
    );
  }, [items, loadError, loading, scopeKey, setRetainedSnapshot]);
  const refresh = useCallback(() => {
    setRefreshNonce((current) => current + 1);
  }, []);

  const visibleSnapshot =
    retainedSnapshot.scopeKey === scopeKey
      ? retainedSnapshot
      : EMPTY_TEAM_INBOX_PULL_REQUESTS_SNAPSHOT;

  return {
    items: visibleSnapshot.items,
    loading: !visibleSnapshot.loaded && loading,
    error: loadError ?? visibleSnapshot.error,
    refresh,
  };
}
