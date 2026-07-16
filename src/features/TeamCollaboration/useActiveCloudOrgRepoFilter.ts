/**
 * Workspace-picker predicate for the active cloud org's repo scope.
 *
 * `null` when no cloud org scope is active (personal / local org scopes are
 * unrestricted). Re-renders when an async git-remote resolution lands in the
 * shared scope-key cache, so repos flip from hidden to eligible without any
 * polling.
 */
import { useAtomValue } from "jotai";
import { useMemo, useSyncExternalStore } from "react";

import { sidebarActiveCloudOrgIdAtom } from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { org2CloudRepoScopesAtom } from "@src/features/Org2Cloud/org2CloudSyncAtoms";

import {
  type OrgScopeFilterRepo,
  repoMatchesOrgScopes,
} from "./orgScopeRepoFilter";
import {
  getShareableScopeKeyVersion,
  subscribeShareableScopeKeys,
} from "./repoScopeResolver";

export type OrgScopeRepoPredicate = (repo: OrgScopeFilterRepo) => boolean;

export function useActiveCloudOrgRepoFilter(): OrgScopeRepoPredicate | null {
  const activeCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const scopesByOrg = useAtomValue(org2CloudRepoScopesAtom);
  const scopeKeyVersion = useSyncExternalStore(
    subscribeShareableScopeKeys,
    getShareableScopeKeyVersion
  );

  return useMemo(() => {
    // scopeKeyVersion invalidates the predicate identity when a cached
    // resolution lands, so memoized consumers re-filter.
    void scopeKeyVersion;
    if (!activeCloudOrgId) return null;
    const orgScopes = scopesByOrg[activeCloudOrgId];
    return (repo: OrgScopeFilterRepo) => repoMatchesOrgScopes(repo, orgScopes);
  }, [activeCloudOrgId, scopesByOrg, scopeKeyVersion]);
}
