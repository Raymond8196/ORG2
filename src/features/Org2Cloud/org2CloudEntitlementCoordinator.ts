/**
 * THE per-org sharing-floor reader (audit 2026-07-18, "one coordinator").
 *
 * Roster bootstrap/refetch and the Realtime change-signal handler previously
 * each owned an entitlement read path with different freshness rules — one
 * unbounded Promise.all per roster load, one hook-local TTL map. Both wrote
 * the same persisted floor mirror, so reconnect could overlap two readers.
 * Every caller now goes through this store-keyed single-flight + TTL gate;
 * no caller keeps its own cache.
 *
 * Writes are per-org and single-flight, so a floor value can never land out
 * of order for one org — the old cross-hydration stamp is unnecessary.
 */
import type { createStore } from "jotai";

import { createLogger } from "@src/hooks/logger";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";

import { org2CloudSharingFloorAtom } from "./org2CloudAccessSettings";
import { getEntitlementState } from "./org2CloudClient";

const log = createLogger("Org2CloudEntitlement");

type JotaiStore = ReturnType<typeof createStore>;

export const ENTITLEMENT_REFRESH_TTL_MS = 60_000;

interface OrgEntitlementEntry {
  lastAttemptAt: number;
  inFlight: Promise<void> | null;
}

const entriesByStore = new WeakMap<
  JotaiStore,
  Map<string, OrgEntitlementEntry>
>();

function entryFor(store: JotaiStore, orgId: string): OrgEntitlementEntry {
  let entries = entriesByStore.get(store);
  if (!entries) {
    entries = new Map();
    entriesByStore.set(store, entries);
  }
  let entry = entries.get(orgId);
  if (!entry) {
    entry = { lastAttemptAt: 0, inFlight: null };
    entries.set(orgId, entry);
  }
  return entry;
}

/**
 * Refresh one org's sharing floor into the persisted mirror. Coalesces into
 * an in-flight read; skips inside the TTL unless `force`. `getAccessToken`
 * is called only when a real read happens (callers keep their own token
 * refresh semantics).
 */
export async function refreshOrgEntitlement(
  store: JotaiStore,
  orgId: string,
  getAccessToken: () => Promise<string | null>,
  options: { force?: boolean } = {}
): Promise<void> {
  const entry = entryFor(store, orgId);
  if (entry.inFlight) return entry.inFlight;
  const now = Date.now();
  if (
    !options.force &&
    now - entry.lastAttemptAt < ENTITLEMENT_REFRESH_TTL_MS
  ) {
    return;
  }
  entry.lastAttemptAt = now;
  const flight = (async () => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;
      const entitlement = await getEntitlementState(accessToken, orgId);
      if (!entitlement) return;
      const floor =
        entitlement.orgSharingFloor ?? COLLAB_SESSION_ACCESS_MODE.OFF;
      store.set(org2CloudSharingFloorAtom, (previous) =>
        previous[orgId] === floor ? previous : { ...previous, [orgId]: floor }
      );
    } catch (error) {
      log.warn(`entitlement refresh failed for org ${orgId}:`, error);
    }
  })();
  entry.inFlight = flight;
  try {
    await flight;
  } finally {
    entry.inFlight = null;
  }
}

export const __ENTITLEMENT_COORDINATOR_INTERNALS = {
  resetForStore(store: JotaiStore): void {
    entriesByStore.delete(store);
  },
};
