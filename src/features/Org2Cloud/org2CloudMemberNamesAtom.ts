import { atom } from "jotai";

import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  type Org2CloudAuthState,
  commitRefreshedAuth,
  org2CloudAuthAtom,
} from "./org2CloudAuthAtom";
import { loadCloudOrgMembers } from "./org2CloudMembersCoordinator";
import { org2CloudRosterVersionAtom } from "./org2CloudOrgsAtom";

const logger = createLogger("org2CloudMemberNames");
export const MAX_CLOUD_MEMBER_NAME_ORGS = 64;

interface CloudMemberNamesEntry {
  identityKey: string;
  rosterVersion: number;
  names: Record<string, string>;
}

export const org2CloudMemberNamesAtom = atom<
  Record<string, CloudMemberNamesEntry>
>({});
org2CloudMemberNamesAtom.debugLabel = "org2CloudMemberNamesAtom";

const inFlightKeys = new Set<string>();

export function cloudMemberNamesIdentityKey(
  auth: Pick<Org2CloudAuthState, "supabaseUrl" | "userId">
): string {
  return `${auth.supabaseUrl.replace(/\/+$/, "")}|${auth.userId}`;
}

export function resolveCloudMemberName(
  names: Record<string, CloudMemberNamesEntry>,
  cloudOrgId: string,
  userId: string,
  identityKey?: string
): string | null {
  const entry = names[cloudOrgId];
  if (!entry || (identityKey && entry.identityKey !== identityKey)) return null;
  return entry.names[userId] ?? null;
}

export async function ensureCloudMemberNames(
  cloudOrgId: string
): Promise<void> {
  const store = getInstrumentedStore();
  const auth = store.get(org2CloudAuthAtom);
  if (!auth) return;
  const identityKey = cloudMemberNamesIdentityKey(auth);
  const rosterVersion = store.get(org2CloudRosterVersionAtom)[cloudOrgId] ?? 0;
  const cached = store.get(org2CloudMemberNamesAtom)[cloudOrgId];
  if (
    cached?.identityKey === identityKey &&
    cached.rosterVersion >= rosterVersion
  ) {
    return;
  }
  const requestKey = `${identityKey}|${cloudOrgId}`;
  if (inFlightKeys.has(requestKey)) return;
  inFlightKeys.add(requestKey);
  try {
    const loaded = await loadCloudOrgMembers(auth, cloudOrgId, rosterVersion);
    if (!loaded) return;
    commitRefreshedAuth(
      (updater) => store.set(org2CloudAuthAtom, updater),
      auth,
      loaded.auth
    );
    const byUserId: Record<string, string> = {};
    for (const member of loaded.members) {
      if (member.displayName) byUserId[member.userId] = member.displayName;
    }
    const latestAuth = store.get(org2CloudAuthAtom);
    if (
      !latestAuth ||
      cloudMemberNamesIdentityKey(latestAuth) !== identityKey
    ) {
      return;
    }
    store.set(org2CloudMemberNamesAtom, (current) => {
      const next = {
        ...current,
        [cloudOrgId]: {
          identityKey,
          rosterVersion,
          names: byUserId,
        },
      };
      const orgIds = Object.keys(next);
      while (orgIds.length > MAX_CLOUD_MEMBER_NAME_ORGS) {
        const oldestOrgId = orgIds.shift();
        if (oldestOrgId) delete next[oldestOrgId];
      }
      return next;
    });
  } catch (error) {
    logger.warn(`failed to load member roster for ${cloudOrgId}`, error);
  } finally {
    inFlightKeys.delete(requestKey);
  }
}
