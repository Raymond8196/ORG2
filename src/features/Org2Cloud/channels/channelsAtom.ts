/**
 * Realtime invalidation state for org channels. The `channels` DB-change
 * signal (0014) bumps the per-org version; `useOrgChannels` refetches on the
 * bump. Server-owned data itself lives in hook state (the
 * `useTeamRuntimeRoster` shape), keyed on `org2CloudAuthIdentityKey`, so an
 * identity switch never leaks one account's channel list into another's.
 */
import { atom } from "jotai";

export const org2CloudChannelsVersionAtom = atom<Record<string, number>>({});
org2CloudChannelsVersionAtom.debugLabel = "org2CloudChannelsVersionAtom";

/** Write-only bump used by the realtime dispatch and by mutation flows. */
export const bumpOrg2CloudChannelsVersionAtom = atom(
  null,
  (get, set, orgId: string) => {
    const current = get(org2CloudChannelsVersionAtom);
    set(org2CloudChannelsVersionAtom, {
      ...current,
      [orgId]: (current[orgId] ?? 0) + 1,
    });
  }
);
bumpOrg2CloudChannelsVersionAtom.debugLabel =
  "bumpOrg2CloudChannelsVersionAtom";
