/**
 * View-layer cloud-org matching for imported CLI sessions (claude/codex/…).
 *
 * Imported-history sessions carry no persisted org_id. Instead of stamping
 * one org onto them at load time, the sidebar matches them against repo
 * scopes AT FILTER TIME: a session whose repo is covered by an org's scope
 * appears under EVERY such org's view, and is hidden from Personal as soon
 * as ANY member org covers it. Pure derivation over lists the sidebar
 * already holds — nothing persisted, nothing polled; async scope-key
 * resolutions land through the shared cache subscription and the memos
 * recompute.
 */
import type { Session } from "@src/store/session";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import { repoMatchesOrgScopes } from "./orgScopeRepoFilter";

type ScopePeek = (input: string) => string | null | undefined;
type ScopePrime = (input: string) => void;

export function isScopeMatchableImportedSession(
  session: Pick<Session, "session_id" | "category" | "orgId" | "repoPath">
): boolean {
  if (session.orgId) return false;
  if (!session.repoPath) return false;
  return (
    isImportedHistorySession(session.session_id) ||
    session.category === "external_history" ||
    session.category === "cursor_ide"
  );
}

/** Imported sessions whose repo falls inside THIS org's repo scope. */
export function collectScopeMatchedImportedSessionIds(
  sessions: readonly Pick<
    Session,
    "session_id" | "category" | "orgId" | "repoPath"
  >[],
  orgScopes: string[] | undefined,
  peek?: ScopePeek,
  prime?: ScopePrime
): Set<string> {
  const ids = new Set<string>();
  if (!orgScopes || orgScopes.length === 0) return ids;
  for (const session of sessions) {
    if (!isScopeMatchableImportedSession(session)) continue;
    if (
      repoMatchesOrgScopes({ fs_uri: session.repoPath }, orgScopes, peek, prime)
    ) {
      ids.add(session.session_id);
    }
  }
  return ids;
}

/** Imported sessions covered by ANY of the member orgs' repo scopes. */
export function collectImportedSessionIdsCoveredByAnyScope(
  sessions: readonly Pick<
    Session,
    "session_id" | "category" | "orgId" | "repoPath"
  >[],
  memberOrgIds: readonly string[],
  scopesByOrg: Record<string, string[]>,
  peek?: ScopePeek,
  prime?: ScopePrime
): Set<string> {
  const ids = new Set<string>();
  if (memberOrgIds.length === 0) return ids;
  for (const session of sessions) {
    if (!isScopeMatchableImportedSession(session)) continue;
    for (const orgId of memberOrgIds) {
      if (
        repoMatchesOrgScopes(
          { fs_uri: session.repoPath },
          scopesByOrg[orgId],
          peek,
          prime
        )
      ) {
        ids.add(session.session_id);
        break;
      }
    }
  }
  return ids;
}
