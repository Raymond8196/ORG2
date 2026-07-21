import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import {
  type CloudOrgMember,
  ensureFreshSession,
  listOrgMembers,
} from "./org2CloudClient";

const ROSTER_CACHE_TTL_MS = 60_000;
const MAX_ROSTER_CACHE_ENTRIES = 64;

interface RosterCacheEntry {
  members: CloudOrgMember[];
  rosterVersion: number;
  expiresAt: number;
}

export interface CloudOrgMembersResult {
  auth: Org2CloudAuthState;
  members: CloudOrgMember[];
}

interface InFlightRosterRequest {
  rosterVersion: number;
  promise: Promise<CloudOrgMembersResult | null>;
}

const rosterCache = new Map<string, RosterCacheEntry>();
const rosterInFlight = new Map<string, InFlightRosterRequest>();

function rosterKey(auth: Org2CloudAuthState, orgId: string): string {
  return `${auth.supabaseUrl.replace(/\/+$/, "")}|${auth.userId}|${orgId}`;
}

function cacheRoster(key: string, entry: RosterCacheEntry): void {
  rosterCache.delete(key);
  rosterCache.set(key, entry);
  while (rosterCache.size > MAX_ROSTER_CACHE_ENTRIES) {
    const oldest = rosterCache.keys().next().value as string | undefined;
    if (!oldest) break;
    rosterCache.delete(oldest);
  }
}

/**
 * One identity-aware, version-aware roster read shared by every rendered
 * consumer. Sidebar, management, share dialogs, and work-item locks can mount
 * together without issuing duplicate list_org_members requests.
 */
export async function loadCloudOrgMembers(
  auth: Org2CloudAuthState,
  orgId: string,
  rosterVersion = 0
): Promise<CloudOrgMembersResult | null> {
  const key = rosterKey(auth, orgId);
  const cached = rosterCache.get(key);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.rosterVersion >= rosterVersion
  ) {
    rosterCache.delete(key);
    rosterCache.set(key, cached);
    return { auth, members: cached.members };
  }

  const pending = rosterInFlight.get(key);
  if (pending && pending.rosterVersion >= rosterVersion) {
    return pending.promise;
  }

  const request: InFlightRosterRequest = {
    rosterVersion,
    promise: Promise.resolve(null),
  };
  request.promise = (async () => {
    const fresh = await ensureFreshSession(auth);
    if (!fresh) return null;
    const members = await listOrgMembers(fresh.accessToken, orgId);
    if (rosterInFlight.get(key) === request) {
      cacheRoster(key, {
        members,
        rosterVersion,
        expiresAt: Date.now() + ROSTER_CACHE_TTL_MS,
      });
    }
    return { auth: fresh, members };
  })().finally(() => {
    if (rosterInFlight.get(key) === request) {
      rosterInFlight.delete(key);
    }
  });
  rosterInFlight.set(key, request);
  return request.promise;
}

/** Test/sign-out support; identity-keying prevents cross-account reads. */
export function clearCloudOrgMembersCache(): void {
  rosterCache.clear();
  rosterInFlight.clear();
}
