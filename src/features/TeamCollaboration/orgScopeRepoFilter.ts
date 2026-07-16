/**
 * Repo eligibility against a cloud org's repo scope (design §8.3).
 *
 * Powers the new-session workspace picker while a cloud org is the active
 * sidebar scope: only repos whose git-remote scope key falls inside the
 * org's repo scope are offered, so an out-of-scope workspace can never be
 * selected (sessions created there would land invisible in the org view).
 *
 * Key resolution mirrors RepoScopePicker: `repo_url` resolves synchronously
 * via normalizeRepoScopeKey; local-only checkouts resolve through the shared
 * scope-key cache (`undefined` = still resolving → treated as not eligible;
 * callers re-render via subscribeShareableScopeKeys once resolution lands).
 */
import { normalizeRepoScopeKey, pickMatchingOrgScope } from "./collabSyncUtils";
import {
  peekShareableScopeKey,
  primeShareableScopeKey,
} from "./repoScopeResolver";

export interface OrgScopeFilterRepo {
  repo_url?: string | null;
  fs_uri?: string | null;
}

export function getRepoScopeKeyForOrgFilter(
  repo: OrgScopeFilterRepo,
  peek: (input: string) => string | null | undefined = peekShareableScopeKey
): string | null | undefined {
  if (repo.repo_url) return normalizeRepoScopeKey(repo.repo_url) || null;
  if (!repo.fs_uri) return null;
  return peek(repo.fs_uri);
}

export function repoMatchesOrgScopes(
  repo: OrgScopeFilterRepo,
  orgScopes: string[] | undefined,
  peek: (input: string) => string | null | undefined = peekShareableScopeKey,
  prime: (input: string) => void = primeShareableScopeKey
): boolean {
  if (!orgScopes || orgScopes.length === 0) return false;
  const key = getRepoScopeKeyForOrgFilter(repo, peek);
  if (key === undefined) {
    if (repo.fs_uri) prime(repo.fs_uri);
    return false;
  }
  if (key === null) return false;
  return pickMatchingOrgScope([key], orgScopes) !== null;
}
