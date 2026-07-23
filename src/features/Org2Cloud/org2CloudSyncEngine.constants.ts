/**
 * Org2CloudSyncEngine — shared cadence/backoff constants.
 *
 * Split out of `org2CloudSyncEngine.ts` so the engine and its composed
 * helpers (schema gate, repo-scope hydration, projects channel, org backoff
 * tracker) can share the same tuned values without importing the whole
 * engine module.
 */

/** Event-throttle for the repo-scope mirror (server truth changes rarely). */
export const SCOPE_HYDRATE_THROTTLE_MS = 10 * 60_000;
/** Re-probe a schema-mismatched custom endpoint after this long (an
 * in-place backend upgrade must heal without an app relaunch). */
export const SCHEMA_MISMATCH_REPROBE_MS = 5 * 60_000;
/** Collab-state delta cursor safety overlap (mirrors CollabSyncEngine §9.4). */
export const CURSOR_OVERLAP_MS = 2_000;

/** Entitlement failures are retried after this bounded cool-down. Realtime
 * policy signals and explicit user changes clear the deadline immediately. */
export const ORG_BACKOFF_COOLDOWN_MS = 5 * 60_000;
/** A background org should not wake the app every five minutes for a quota
 * condition the user is not currently looking at. Selecting or explicitly
 * changing that org still clears this deadline immediately. */
export const INACTIVE_ORG_BACKOFF_COOLDOWN_MS = 30 * 60_000;
