/**
 * Org2CloudSyncEngine — shared cadence/backoff constants.
 *
 * Split out of `org2CloudSyncEngine.ts` so the engine and its composed
 * helpers (schema gate, repo-scope hydration, projects channel, org backoff
 * tracker) can share the same tuned values without importing the whole
 * engine module.
 */

/** Repo-scope mirror refresh cadence (server truth changes rarely). */
export const SCOPE_HYDRATE_TTL_MS = 10 * 60_000;
/** Inactive orgs heal on a quiet disaster-recovery cadence; selecting the
 * org subscribes Realtime and immediately forces a fresh pull. */
export const INACTIVE_ORG_FALLBACK_INTERVAL_MS = 30 * 60_000;
/** Re-probe a schema-mismatched custom endpoint after this long (an
 * in-place backend upgrade must heal without an app relaunch). */
export const SCHEMA_MISMATCH_REPROBE_MS = 5 * 60_000;
/** Collab-state delta cursor safety overlap (mirrors CollabSyncEngine §9.4). */
export const CURSOR_OVERLAP_MS = 2_000;

/**
 * Inbound (cloud→local) fallback cadence. Since inbound pulls are now driven
 * by Supabase Realtime (useOrg2CloudRealtime), the recurring pass only performs
 * the inbound planes (repo scopes / projects+work-items / comments) as an
 * eventual-consistency SAFETY NET — for when the socket is down, an event was
 * missed, or the custom backend has no Realtime. Outbound push is UNAFFECTED:
 * it stays event-driven (es:changed) with the full-cadence pass as its own
 * safety net. A Realtime invalidation (`invalidateOrgInbound`) bypasses this
 * gate so a live event still triggers an immediate inbound pull.
 */
export const INBOUND_FALLBACK_INTERVAL_MS = 5 * 60_000;

/** Entitlement failures are retried after this bounded cool-down. Realtime
 * policy signals and explicit user changes clear the deadline immediately. */
export const ORG_BACKOFF_COOLDOWN_MS = 5 * 60_000;
/** A background org should not wake the app every five minutes for a quota
 * condition the user is not currently looking at. Selecting or explicitly
 * changing that org still clears this deadline immediately. */
export const INACTIVE_ORG_BACKOFF_COOLDOWN_MS = 30 * 60_000;
