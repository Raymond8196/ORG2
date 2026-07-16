/**
 * Repo eligibility against a cloud org's repo scope (design §8.3).
 *
 * Powers the new-session workspace picker while a cloud org is the active
 * sidebar scope, and the sidebar's imported-session grouping.
 *
 * Matching is by ANY of the checkout's git-remote scope keys — a fork
 * checkout whose upstream hits the org scope is in scope (same
 * `pickMatchingOrgScope` semantics as autoTag / MoveToOrgDialog / the sync
 * engine). `repo_url` resolves synchronously; local-only checkouts resolve
 * through the shared scope-key cache.
 *
 * Two eligibility modes:
 * - `repoMatchesOrgScopes` — STRICT: only a resolved match counts. Used
 *   for session grouping, where hiding/adopting needs evidence.
 * - `repoEligibleForOrgScopedPicker` — OPTIMISTIC: a still-resolving
 *   checkout stays visible (and is primed) until the cache lands, then
 *   converges. Hiding an in-scope repo behind a cold cache would make it
 *   look permanently unselectable.
 */
import { normalizeRepoScopeKey, pickMatchingOrgScope } from "./collabSyncUtils";
import {
  peekShareableScopeKeys,
  primeShareableScopeKey,
} from "./repoScopeResolver";

export interface OrgScopeFilterRepo {
  repo_url?: string | null;
  fs_uri?: string | null;
}

type ScopeKeysPeek = (input: string) => string[] | null | undefined;
type ScopePrime = (input: string) => void;

export function getRepoScopeKeysForOrgFilter(
  repo: OrgScopeFilterRepo,
  peekKeys: ScopeKeysPeek = peekShareableScopeKeys
): string[] | null | undefined {
  if (repo.repo_url) {
    const key = normalizeRepoScopeKey(repo.repo_url);
    return key ? [key] : null;
  }
  if (!repo.fs_uri) return null;
  return peekKeys(repo.fs_uri);
}

export function repoMatchesOrgScopes(
  repo: OrgScopeFilterRepo,
  orgScopes: string[] | undefined,
  peekKeys: ScopeKeysPeek = peekShareableScopeKeys,
  prime: ScopePrime = primeShareableScopeKey
): boolean {
  if (!orgScopes || orgScopes.length === 0) return false;
  const keys = getRepoScopeKeysForOrgFilter(repo, peekKeys);
  if (keys === undefined) {
    if (repo.fs_uri) prime(repo.fs_uri);
    return false;
  }
  if (!keys || keys.length === 0) return false;
  return pickMatchingOrgScope(keys, orgScopes) !== null;
}

export function repoEligibleForOrgScopedPicker(
  repo: OrgScopeFilterRepo,
  orgScopes: string[] | undefined,
  peekKeys: ScopeKeysPeek = peekShareableScopeKeys,
  prime: ScopePrime = primeShareableScopeKey
): boolean {
  if (!orgScopes || orgScopes.length === 0) return false;
  const keys = getRepoScopeKeysForOrgFilter(repo, peekKeys);
  if (keys === undefined) {
    if (repo.fs_uri) prime(repo.fs_uri);
    return true;
  }
  if (!keys || keys.length === 0) return false;
  return pickMatchingOrgScope(keys, orgScopes) !== null;
}
