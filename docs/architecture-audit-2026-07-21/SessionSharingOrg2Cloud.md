# Architecture Audit — Org2Cloud Session Sharing (branch + local changes)

Date: 2026-07-21
Scope: the entire session-sharing surface (`src/features/Org2Cloud/**`, its UI consumers, the Rust
runtime-instance isolation changes, and the dual-instance E2E suite) plus every uncommitted local
change on this branch (38 files).

## Layers covered

| Layer                     | Covered                 | Result                                                                                                                                                                |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | yes                     | `tsc --noEmit` clean; `cargo check` clean; 550/550 Org2Cloud unit tests pass                                                                                          |
| 2 Dead code / duplication | yes                     | one duplicate found and removed pre-branch (`cloudMemberNamesIdentityKey` folded into `org2CloudAuthIdentityKey`); roster reads unified through `loadCloudOrgMembers` |
| 3 Naming consistency      | yes                     | `org2CloudAuthIdentityKey` is the single identity-key constructor (verified by sweep: exactly one `${supabaseUrl}                                                     |
| 4 Semantic overloading    | yes                     | "identityKey", "rosterVersion", "force", "signal" each have one meaning; see term table below                                                                         |
| 5 Default branch analysis | yes                     | fail-open defaults documented at each site (`canAnchorTurns`, guest-share transient errors)                                                                           |
| 6 Cross-domain leakage    | yes                     | E2E helpers read-only (`cloudInspectMemberRoster` never mutates); prod paths never import e2e helpers                                                                 |
| 7 New-developer confusion | yes                     | in-file contracts documented (force-token queue, merge-not-replace comments fetch)                                                                                    |
| 8 Wire protocol           | partial (intentionally) | no serialization format changed on this branch; RPC payload shapes untouched                                                                                          |
| 9 Init parity             | yes                     | primary vs. WebDriver-secondary Rust identity parity test added (`webdriver_secondary_identifier_keeps_the_same_isolation_profile`)                                   |
| 10 Resolver symmetry      | yes                     | remote-sessions reads audited for identity-filter symmetry; two asymmetric readers fixed (below)                                                                      |

## Term table (Layer 4)

| Term            | Usage                                                                                                                                  | Verdict                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `identityKey`   | `org2CloudAuthIdentityKey(auth)` = normalized `supabaseUrl                                                                             | userId`; keys caches, in-flight maps, snapshot guards                                    |
| `rosterVersion` | per-org Realtime invalidation counter (`org2CloudRosterVersionAtom`), consumed by panel/sidebar/member-names fetch effects             | single meaning — OK                                                                      |
| `force`         | "ignore completed TTL entry, still join an equal/newer in-flight request" (`LoadCloudOrgMembersOptions.force`, comments `queue_force`) | consistent, documented at both sites — OK                                                |
| `signal`        | (a) Realtime `org_change_signals` table, (b) comments-bus counters, (c) `AbortSignal` in guest-share flights                           | contexts are disjoint (table name / atom / DOM API); no rename needed — keep with reason |

## Findings and fixes made in this pass

### F1 (fixed) — `SessionViewersIndicator` read the remote-sessions atom asymmetrically

`useOrg2CloudRealtime` Slice C resolves presence refs from
`remoteSessionsEntryForIdentity(remoteSessions[activeRealtimeOrgId], authIdentityKey)?.rows`,
but `SessionViewersIndicator` flattened **all orgs' rows without an identity filter**
(`Object.values(remoteSessions).flatMap((entry) => entry.rows)`). Resolver-symmetry violation
(Layer 10): two resolvers of the same concept ("which cloud refs does this session map to")
walked different source chains. Exposure was small (the `useLayoutEffect` in
`useOrg2CloudRealtime` clears the atom before paint on identity change, and refs are re-filtered
by `ref.orgId !== activeCloudOrgId`) but the asymmetry invited drift, and the flatMap allocated
O(total cached rows) on every presence/session change.
**Fix:** the indicator now reads the identical identity-filtered active-org entry as Slice C.

### F2 (fixed) — `useSessionCommentViewer` decided `canAnchorTurns` from an unfiltered row

`SessionCommentsContext.useSessionCommentViewer` read `remoteEntries[target.orgId]?.rows` raw.
Every other remote-sessions consumer goes through `remoteSessionsEntryForIdentity`. A stale row
from a previous account could decide anchor capability during a switch commit.
**Fix:** the read is now identity-filtered; a filtered-out row falls into the documented
fail-open default (`canAnchorTurns: true`, server enforces regardless).

### F3 (fixed) — unstable empty-array reference in `useCloudOrgPanelState`

`visibleMembers` returned a fresh `[]` on every render during an identity-mismatch window,
invalidating downstream memos each render. Hoisted a module-level `NO_VISIBLE_MEMBERS` constant.

### F4 (fixed) — sync engine ignored identity boundaries

`useOrg2CloudSyncEngine` started the engine once on mount and never stopped it: the recurring
pass timer kept ticking while signed out, and every per-identity engine `Map` (push hashes,
activity stamps, inbound cursors, backoff, schema gate) survived an account/endpoint switch.
**Fix:** the hook is now keyed to `org2CloudAuthIdentityKey` — `stop()` (which drains waiters,
bumps the generation, and calls `resetSyncState()`) on every identity change, `start()` only
while an identity exists. Signed out ⇒ zero engine timers.

### F5 (fixed) — presence `onSync` wrote semantically identical rosters

Every Supabase presence sync frame (including heartbeats where nothing changed) produced a new
roster object in `org2CloudPresenceAtom`, re-rendering every presence consumer — including the
sidebar section that rebuilds its menu tree. **Fix:** `org2CloudPresenceRosterEquals` compares
by `userId`/`displayName`/`viewingSessionId` (deliberately ignoring `updatedAt`, which changes
on every heartbeat) and `setPresence` keeps the previous object when equal.

### F6 (fixed) — `refreshShares` could set state after unmount

`useCloudShareOrgSectionModel.refreshShares` awaited a token refresh + list RPC and then wrote
state guarded only by an identity check. **Fix:** an `unmountedRef` guard added to the same
commit gate (identity check unchanged).

### F7 (fixed) — comments-signal atom grew without bound

`org2CloudCommentsSignalAtom` gained one counter per (org, session) ever nudged and was only
cleared on identity change. **Fix:** all three writers (local bump, org-signal bump, peer
broadcast handler) now route through `bumpCommentsSignalKey`, a pure LRU-bounded bump capped at
`MAX_COMMENTS_SIGNAL_KEYS = 256` (unit-tested: cap, eviction order, recency refresh,
non-mutation).

### F8 (fixed) — presence track/broadcast retried at 1 Hz forever on persistent failure

A persistently rejected `track()` or broadcast `send()` (bad policy, revoked token) re-armed a
fixed 1-second retry for the channel's lifetime. **Fix:** capped exponential backoff (1s base,
30s ceiling) with the failure streak reset on success and on every fresh `SUBSCRIBED` edge, so
transient blips still retry fast (unit-tested: backoff cadence, ceiling, reset-on-success).

### F9 (documented) — presence topic reuse contract

Presence topics cannot carry the connection-local sequence suffix postgres channels use (peers
must join the identical topic string and RLS authorizes exactly it). A contract comment on
`joinPresence` now states the invariant; the one production caller satisfies it by rebuilding
the whole connection on every user/endpoint/org change.

### Kept with reason

| Site                                             | Element                                                         | Reason kept                                                                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionForkHeaderExtras.handleOpenParent`       | raw `remoteEntries[orgId]` lookup                               | event-handler-time read (not render state); result feeds `openRemoteParent` whose server call re-authorizes; identity clear runs before user can click post-switch                                            |
| `useCloudOrgPanelState` member fallback          | 30s `setInterval` kept ticking while hidden                     | tick body checks `document.visibilityState` and skips the fetch; interval itself is cheap and guarantees an immediate refresh on the first visible tick; teardown on org/identity/sign-out change verified    |
| `org2CloudRosterReconcile.shouldReconcileRoster` | prunes on an authoritatively EMPTY roster                       | deliberate change on this branch: an empty roster is valid evidence (account left all orgs / backend wiped) and must prune backend-owned per-org maps; transient failures keep `loaded=false` and never prune |
| `useRefetchOrg2CloudOrgs` `until` loop           | up to 4 back-to-back `list_my_orgs` with no inter-attempt delay | each attempt is gated by real network round-trips; postcondition normally converges by attempt 2; bounded and only used by mutation flows                                                                     |

## Local-change verdict (per file class)

- **Identity keying (`org2CloudAuthAtom`, members coordinator, member names, remote sessions, comments, panel/dialog/sidebar consumers):** correct and uniform. Every async commit re-checks `org2CloudAuthIdentityKey(authRef.current) === requestIdentityKey` before writing; snapshot state carries the identity it was fetched under.
- **LRU bounds:** `MAX_ROSTER_CACHE_ENTRIES=64`, `MAX_CLOUD_MEMBER_NAME_ORGS=64`, `MAX_REMOTE_SESSION_CACHE_ENTRIES=64`, `MAX_REMOTE_SESSIONS_VERSION_KEYS=64`, `MAX_SESSION_COMMENT_CACHE_ENTRIES=128`, `COMPLETED_FORCE_TOKEN_CACHE_MAX=500` — all insert-order LRU with recency refresh on hit.
- **Per-store state:** members coordinator and member-names in-flight maps moved to `WeakMap<JotaiStore, …>`; store disposal cannot leak across rendered instances.
- **Realtime scoping (`resolveActiveRealtimeOrgId` + `useOrg2CloudRealtime`):** channels exist only for the active cloud org; identity-owned caches cleared in one `useLayoutEffect` on identity change; roster refetch on `org_change_signals` is TTL-gated (10s) with a trailing timer so a gated signal is deferred, never dropped, and the trailing timer is cleared on unsubscribe.
- **Rust (`runtime_instance.rs`, `lib.rs`):** `yorg.orgii.e2e.instance{N}` now parses to the same isolation profile as `yorg.orgii.instance{N}` (ports, data home, external-history home); covered by a unit test. `lib.rs` change is formatting only.
- **E2E (`cloud-dual-instance-ui.spec.mjs`, `dualCloudHarness.mjs`, `agentOrgUiDriver.mjs`):** oauth-live mode seeds ONLY the explicitly selected secondary account from the already-isolated primary home (never the user's real credentials file), refuses to share one OAuth chain across two live apps, atomically writes credentials, and merges token rotations back on stop. Diagnostics were added to failure paths (`cloudInspectMemberRoster`, presence dumps) without weakening assertions — timeouts still throw.
- `**ChatHistoryView` → published header move for `SessionViewersIndicator`:\*\* the indicator now renders in the published session header (ChatPanel) and the workstation tab header — the two surfaces are mutually exclusive homes for a session, so no double-render/double-subscription exists; the E2E asserts the published-header placement.

## Sweeps run (Systematic Sweep Discipline)

| Pattern class                                        | Sweep                                           | Result                                                                                                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unfiltered remote-sessions reads                     | grep all `remoteSessions[`/`.rows` consumers    | F1, F2 fixed; `SessionForkHeaderExtras` kept with reason (table above)                                                                                                                   |
| Unbounded `Record<string, number>` version counters  | grep `atom<Record<string, number>>`             | comments-signal fixed (F7); roster + remote-sessions versions are per-org (bounded by membership, cleared on identity change); remote-sessions fetched-versions already LRU-capped at 64 |
| Fixed-cadence retry timers                           | grep `RETRY_MS`/`setTimeout` in realtime client | track + broadcast both fixed (F8); `PRESENCE_CALL_WINDOW` scheduler is a rate limiter, not a retry — kept                                                                                |
| Post-async `setState` without unmount/identity guard | grep async commits in Org2Cloud hooks           | F6 fixed; all other commits already carry identity re-check + epoch guards                                                                                                               |
| Per-instance registries keyed under a shared slot    | `sessionCommentPresentEventIdsAtom`             | keyed session → provider-instance → set with symmetric unmount cleanup deleting the session slot when the last instance leaves — bounded by mounted panes, OK                            |

## Verification

- `tsc --noEmit`: clean (after all fixes F1–F9).
- `pnpm vitest run src/features/Org2Cloud`: 51 files, 557 tests, all pass (includes new
  `org2CloudCommentsBus.test.ts` and the four new realtime-client backoff tests).
- Wider sweep `pnpm vitest run src/features/Org2Cloud src/features/TeamCollaboration src/engines/ChatPanel`: 151 files, 1476 tests, all pass.
- `cargo check`: clean. `git diff --check`: clean. ESLint + Prettier on changed files: clean.
