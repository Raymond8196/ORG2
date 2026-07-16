/**
 * Derived cloud-org grouping for imported CLI sessions (claude/codex/…).
 *
 * External-history sessions carry no persisted org_id; without this overlay
 * they all pile up under Personal even when their repo sits squarely inside
 * a cloud org's repo scope. At list-materialization time we stamp the
 * in-memory `Session.orgId` with the ONE org whose scope covers the
 * session's repo — pure derivation over the existing load path: nothing is
 * persisted, nothing polls, and a scope change regroups on the next natural
 * refresh.
 *
 * A repo scoped by MULTIPLE orgs stays in Personal (ambiguous adoption is
 * worse than none). Scope-key resolution is cache-only here (`peek`);
 * unresolved paths are primed and adopt on a later pass.
 */
import {
  type Org2CloudOrg,
  org2CloudOrgsAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { org2CloudRepoScopesAtom } from "@src/features/Org2Cloud/org2CloudSyncAtoms";
import type { Session } from "@src/store/session";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import { pickMatchingOrgScope } from "./collabSyncUtils";
import {
  peekShareableScopeKeys,
  primeShareableScopeKey,
} from "./repoScopeResolver";

export interface ImportedSessionOrgOverlayContext {
  memberOrgIds: readonly string[];
  scopesByOrg: Record<string, string[]>;
  peekKeys?: (input: string) => string[] | null | undefined;
  prime?: (input: string) => void;
}

export function resolveImportedSessionCloudOrgId(
  repoPath: string | null | undefined,
  context: ImportedSessionOrgOverlayContext
): string | null {
  if (!repoPath) return null;
  const peek = context.peekKeys ?? peekShareableScopeKeys;
  const prime = context.prime ?? primeShareableScopeKey;
  const scopeKeys = peek(repoPath);
  if (scopeKeys === undefined) {
    prime(repoPath);
    return null;
  }
  if (!scopeKeys || scopeKeys.length === 0) return null;

  let matched: string | null = null;
  for (const orgId of context.memberOrgIds) {
    if (pickMatchingOrgScope(scopeKeys, context.scopesByOrg[orgId]) === null) {
      continue;
    }
    if (matched !== null) return null;
    matched = orgId;
  }
  return matched;
}

function currentOverlayContext(): ImportedSessionOrgOverlayContext | null {
  if (!isStoreInitialized()) return null;
  const store = getInstrumentedStore();
  const memberOrgIds = store
    .get(org2CloudOrgsAtom)
    .map((org: Org2CloudOrg) => org.orgId);
  if (memberOrgIds.length === 0) return null;
  return { memberOrgIds, scopesByOrg: store.get(org2CloudRepoScopesAtom) };
}

/**
 * Stamp imported-history sessions with their scope-matched cloud org.
 * Returns the input array unchanged (same reference) when nothing matched,
 * so memoized consumers don't re-render for a no-op pass.
 */
export function overlayImportedSessionsCloudOrg(
  sessions: Session[]
): Session[] {
  const context = currentOverlayContext();
  if (!context) return sessions;

  let changed = false;
  const next = sessions.map((session) => {
    if (session.orgId) return session;
    if (
      !isImportedHistorySession(session.session_id) &&
      session.category !== "external_history" &&
      session.category !== "cursor_ide"
    ) {
      return session;
    }
    const orgId = resolveImportedSessionCloudOrgId(session.repoPath, context);
    if (!orgId) return session;
    changed = true;
    return { ...session, orgId };
  });
  return changed ? next : sessions;
}
