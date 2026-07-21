/**
 * Per-(orgId, sessionId) session-comment threads (in-memory only).
 *
 * Maps `orgId|sessionId` → the session's `cloud_list_session_comments`
 * entries plus fetch state. Fetched lazily by `useSessionComments` when a
 * comment surface (replay transcript / header notes) mounts for a cloud
 * target, with a short TTL so toggling a thread panel doesn't refetch on
 * every render; `refresh()` bypasses the TTL. Mutations write through the
 * 0014 RPCs and patch the entry in place — the add RPC returns the created
 * row in listing shape, so the insert needs no refetch (design §4
 * "optimistic insert on add"). NOT persisted — visibility is server-side
 * (readable guard + retention window) and rows go stale.
 */
import { atom, useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";

import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { ensureFreshSession } from "./org2CloudClient";
import {
  broadcastCommentsChangedToPeers,
  org2CloudCommentsSignalAtom,
  orgCommentsKey,
  sessionCommentsKey,
} from "./org2CloudCommentsBus";
import {
  type CloudCommentResolution,
  type CloudSessionComment,
  addSessionComment,
  deleteSessionComment,
  editSessionComment,
  isOrg2CommentErrorCode,
  listSessionComments,
  resolveSessionComment,
} from "./org2CloudCommentsClient";

const log = createLogger("Org2CloudSessionComments");

const SESSION_COMMENTS_TTL_MS = 30_000;
export const MAX_SESSION_COMMENT_CACHE_ENTRIES = 128;

/**
 * A transient listing failure (network blip, or the session row sitting in
 * a momentary engine retract/re-upsert window) must not pin `state:"error"`
 * for the full TTL: an error entry becomes re-claimable after this window,
 * and a mounted consumer arms one deferred retry to actually re-run it.
 */
export const SESSION_COMMENTS_ERROR_RETRY_MS = 10_000;

export type CloudSessionCommentsFetchState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface CloudSessionCommentsEntry {
  /** Prevents cached bodies from crossing an account or endpoint switch. */
  identityKey?: string;
  comments: CloudSessionComment[];
  /** Server-derived permission for spending this session owner's local model. */
  viewerOwnsSession: boolean;
  state: CloudSessionCommentsFetchState;
  /** Last fetch failure (diagnostics only — UI keys on `state`). */
  errorMessage?: string;
  /** Epoch ms of the last completed fetch attempt (0 ⇒ never fetched). */
  fetchedAt: number;
}

const EMPTY_ENTRY: CloudSessionCommentsEntry = {
  comments: [],
  viewerOwnsSession: false,
  state: "idle",
  fetchedAt: 0,
};

export function sessionCommentsEntryForIdentity(
  entry: CloudSessionCommentsEntry | undefined,
  identityKey: string | null
): CloudSessionCommentsEntry | undefined {
  return identityKey && entry?.identityKey === identityKey ? entry : undefined;
}

export function writeSessionCommentsEntry(
  entries: Record<string, CloudSessionCommentsEntry>,
  key: string,
  entry: CloudSessionCommentsEntry
): Record<string, CloudSessionCommentsEntry> {
  const next = { ...entries };
  delete next[key];
  next[key] = entry;
  const keys = Object.keys(next);
  while (keys.length > MAX_SESSION_COMMENT_CACHE_ENTRIES) {
    const oldest = keys.shift();
    if (oldest) delete next[oldest];
  }
  return next;
}

export const org2CloudSessionCommentsAtom = atom<
  Record<string, CloudSessionCommentsEntry>
>({});
org2CloudSessionCommentsAtom.debugLabel = "org2CloudSessionCommentsAtom";

// ---------------------------------------------------------------------------
// Pure list transforms (unit-tested; no IO)
// ---------------------------------------------------------------------------

function compareComments(
  left: CloudSessionComment,
  right: CloudSessionComment
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  // Deterministic tiebreak, mirroring the server's `order by created_at, id`.
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Insert (or replace by id) keeping the server's (createdAt, id) order. */
export function insertComment(
  comments: readonly CloudSessionComment[],
  comment: CloudSessionComment
): CloudSessionComment[] {
  const next = comments.filter((existing) => existing.id !== comment.id);
  next.push(comment);
  next.sort(compareComments);
  return next;
}

/** Shallow-patch one comment by id (no-op when the id is unknown). */
export function patchComment(
  comments: readonly CloudSessionComment[],
  commentId: string,
  patch: Partial<CloudSessionComment>
): CloudSessionComment[] {
  return comments.map((comment) =>
    comment.id === commentId ? { ...comment, ...patch } : comment
  );
}

export type SessionCommentsFetchDecision = "claim" | "skip" | "queue_force";

/**
 * The atomic-claim decision, extracted pure so the force-vs-in-flight race
 * is testable: a FORCED refresh that lands while a fetch is in flight must
 * never be silently dropped — its intent is queued and replayed once the running fetch
 * settles. Non-forced calls behind an in-flight fetch or a fresh TTL stay
 * plain skips.
 */
export function decideSessionCommentsFetch(
  entry: CloudSessionCommentsEntry | undefined,
  force: boolean,
  now: number
): SessionCommentsFetchDecision {
  if (entry?.state === "loading") return force ? "queue_force" : "skip";
  const freshnessWindowMs =
    entry?.state === "error"
      ? SESSION_COMMENTS_ERROR_RETRY_MS
      : SESSION_COMMENTS_TTL_MS;
  const fresh =
    entry !== undefined &&
    entry.state !== "idle" &&
    now - entry.fetchedAt <= freshnessWindowMs;
  if (fresh && !force) return "skip";
  return "claim";
}

/**
 * Errors meaning the viewer may no longer SEE this session's comments at
 * all (visibility flip to 'restricted', revoked grant, deleted session).
 * The cached entry must then be EVICTED, not merely flagged 'error': the
 * atom is app-lifetime, and keeping thread bodies readable after the
 * server said FORBIDDEN would defeat the 0002 visibility mirror for
 * already-cached data. Transient failures (network, auth refresh) keep
 * the cache — going blank on a blip would be worse than stale.
 */
export function shouldEvictSessionCommentsOnError(error: unknown): boolean {
  return (
    isOrg2CommentErrorCode(error, "ORG2_FORBIDDEN") ||
    isOrg2CommentErrorCode(error, "ORG2_SESSION_NOT_FOUND")
  );
}

// ---------------------------------------------------------------------------
// Thread grouping (pure; unit-tested)
// ---------------------------------------------------------------------------

export interface CommentThread {
  top: CloudSessionComment;
  /** Direct replies, (createdAt, id) asc. Flat: replies never nest. */
  replies: CloudSessionComment[];
}

export interface GroupedCommentThreads {
  /** Threads anchored to a PRESENT event id, keyed by that id. */
  byEventId: Map<string, CommentThread[]>;
  /** Unanchored session-level notes. */
  sessionLevel: CommentThread[];
  /**
   * Threads whose anchor event no longer exists in the local replay stream
   * (owner-side epoch rewrite dropped it). Rendered in an "earlier version"
   * bucket — never crash, never silently vanish.
   */
  orphaned: CommentThread[];
}

function isLiveComment(comment: CloudSessionComment): boolean {
  return !comment.deletedAt;
}

/**
 * Group a session's flat comment list into render-ready threads.
 *
 * - Tombstoned members stay IN their thread (rendered as "comment deleted")
 *   so reply chains keep their anchor; a thread whose every member is a
 *   tombstone is dropped entirely (nothing left to show).
 * - Replies whose parent is missing from the list are dropped defensively
 *   (the server's flat-thread + cascade invariants make this unreachable,
 *   but a stale cache must not crash the transcript).
 * - `presentEventIds === null` means "presence unknown" — anchored threads
 *   then classify as present (`byEventId`), never as orphans.
 */
export function groupCommentThreads(
  comments: readonly CloudSessionComment[],
  presentEventIds: ReadonlySet<string> | null
): GroupedCommentThreads {
  const ordered = [...comments].sort(compareComments);

  const threadsById = new Map<string, CommentThread>();
  const topLevels: CommentThread[] = [];
  for (const comment of ordered) {
    if (comment.parentId) continue;
    const thread: CommentThread = { top: comment, replies: [] };
    threadsById.set(comment.id, thread);
    topLevels.push(thread);
  }
  for (const comment of ordered) {
    if (!comment.parentId) continue;
    threadsById.get(comment.parentId)?.replies.push(comment);
  }

  const byEventId = new Map<string, CommentThread[]>();
  const sessionLevel: CommentThread[] = [];
  const orphaned: CommentThread[] = [];
  for (const thread of topLevels) {
    const hasLiveMember =
      isLiveComment(thread.top) || thread.replies.some(isLiveComment);
    if (!hasLiveMember) continue;

    const anchor = thread.top.eventId;
    if (!anchor) {
      sessionLevel.push(thread);
    } else if (presentEventIds === null || presentEventIds.has(anchor)) {
      const bucket = byEventId.get(anchor);
      if (bucket) {
        bucket.push(thread);
      } else {
        byEventId.set(anchor, [thread]);
      }
    } else {
      orphaned.push(thread);
    }
  }

  return { byEventId, sessionLevel, orphaned };
}

/**
 * Union of the per-provider replay-stream id sets registered for ONE
 * session (`sessionCommentPresentEventIdsAtom` is keyed session → provider
 * instance → id set, so two panes showing the SAME session never clobber
 * each other's entry and closing one pane cannot blank the other's orphan
 * bucket). `null` = no provider currently publishes — presence UNKNOWN,
 * and `groupCommentThreads` then never classifies orphans.
 */
export function mergePresentEventIdEntries(
  entries: Record<string, ReadonlySet<string>> | undefined
): ReadonlySet<string> | null {
  if (!entries) return null;
  const sets = Object.values(entries);
  if (sets.length === 0) return null;
  if (sets.length === 1) return sets[0];
  const merged = new Set<string>();
  for (const set of sets) {
    for (const id of set) merged.add(id);
  }
  return merged;
}

/** Resolve state lives on the thread head (design: thread-level state). */
export function isThreadResolved(thread: CommentThread): boolean {
  return Boolean(thread.top.resolvedAt);
}

export function getThreadResolution(
  thread: CommentThread
): CloudCommentResolution | null {
  if (!thread.top.resolvedAt) return null;
  return thread.top.resolution ?? "resolved";
}

/** Live (non-tombstone) comments across the given threads — badge counts. */
export function countLiveComments(threads: readonly CommentThread[]): number {
  let count = 0;
  for (const thread of threads) {
    if (isLiveComment(thread.top)) count++;
    for (const reply of thread.replies) {
      if (isLiveComment(reply)) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Shared auth composition
// ---------------------------------------------------------------------------

/**
 * The `ensureFreshSession` + `commitRefreshedAuth` composition as ONE
 * stable callback: a fresh JWT per RPC batch, committed compare-and-set so
 * a signed-out auth atom is never resurrected. This is the blessed
 * React-side variant of the idiom, shared by `useSessionComments` and the
 * task surfaces (`SessionCommentsContext`'s create/reopen/reset wrappers);
 * the headless runner carries its own store-backed copy inside
 * `buildDefaultCommentTaskRunnerDeps`. Reads auth through a ref so the
 * token-refresh write inside a batch never retriggers the callers' effects
 * (org2CloudRemoteSessionsAtom idiom).
 */
export function useCloudFreshAccessToken(): () => Promise<string> {
  const [auth, setAuth] = useAtom(org2CloudAuthAtom);
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  return useCallback(async (): Promise<string> => {
    const current = authRef.current;
    if (!current) throw new Error("not signed in to ORG2 Cloud");
    const fresh = await ensureFreshSession(current);
    if (!fresh) throw new Error("token refresh failed");
    commitRefreshedAuth(setAuth, current, fresh);
    return fresh.accessToken;
  }, [setAuth]);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface AddCommentInput {
  body: string;
  eventId?: string;
  parentId?: string;
}

export interface UseSessionCommentsResult {
  comments: CloudSessionComment[];
  viewerOwnsSession: boolean;
  state: CloudSessionCommentsFetchState;
  /** Refetch now, ignoring the TTL. */
  refresh: () => void;
  /**
   * Local-only insert of a server-shaped comment row — the complete RPC
   * returns its `agent_report` reply byte-identical to a list entry
   * (add/list parity rule), so the runner bridge inserts it without a
   * refetch. No RPC fires; the next TTL refetch reconciles regardless.
   */
  insertLocalComment: (comment: CloudSessionComment) => void;
  /** Resolves with the created comment (already inserted); rejects on
   *  failure so composers can keep the draft (design §4 non-goals). */
  addComment: (input: AddCommentInput) => Promise<CloudSessionComment>;
  editComment: (commentId: string, body: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  resolveComment: (
    commentId: string,
    resolved: boolean,
    resolution?: CloudCommentResolution
  ) => Promise<void>;
}

/**
 * Comments for `(orgId, sessionId)` (either null ⇒ no cloud comment target —
 * returns the idle empty entry, fetches nothing, mutations reject).
 * Auto-fetches when the entry is missing or older than the TTL. Multiple
 * mounted instances (turn chrome + header notes) share the atom entry; the
 * fetch CLAIM happens inside one atom updater (decide-and-mark against live
 * store state), so two instances mounting in the same commit cannot both
 * fire the list RPC — a render-snapshot guard would.
 */
/**
 * Keys whose in-flight fetch swallowed a FORCED refresh: replayed with one
 * more forced fetch the moment the running fetch settles (module-level —
 * the atom entry is shared across hook instances, so the queue must be
 * too). A Set, so N dropped forces replay as ONE refetch.
 */
const pendingForceRefetchKeys = new Set<string>();
/** Signal-aware force dedup shared across hook instances. The same Realtime
 * generation may be observed by header and transcript subscribers; it must
 * produce one request, not one sequential request per subscriber. */
const activeForceTokenByKey = new Map<string, string>();
const pendingForceTokenByKey = new Map<string, string>();
const completedForceTokenByKey = new Map<string, string>();
const COMPLETED_FORCE_TOKEN_CACHE_MAX = 500;

function rememberCompletedForceToken(key: string, token: string): void {
  completedForceTokenByKey.delete(key);
  completedForceTokenByKey.set(key, token);
  if (completedForceTokenByKey.size <= COMPLETED_FORCE_TOKEN_CACHE_MAX) return;
  const oldestKey = completedForceTokenByKey.keys().next().value;
  if (oldestKey !== undefined) completedForceTokenByKey.delete(oldestKey);
}

function dropPendingForce(key: string): void {
  pendingForceTokenByKey.delete(key);
  pendingForceRefetchKeys.delete(key);
}

export function useSessionComments(
  orgId: string | null,
  sessionId: string | null,
  originSessionId: string | null = null
): UseSessionCommentsResult {
  const auth = useAtomValue(org2CloudAuthAtom);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  const [entries, setEntries] = useAtom(org2CloudSessionCommentsAtom);
  const signedIn = Boolean(auth);
  const key = orgId && sessionId ? sessionCommentsKey(orgId, sessionId) : null;

  const withFreshToken = useCloudFreshAccessToken();

  const fetchComments = useCallback(
    async (
      targetOrgId: string,
      targetSessionId: string,
      options?: { force?: boolean; forceToken?: string }
    ): Promise<void> => {
      const targetKey = sessionCommentsKey(targetOrgId, targetSessionId);
      const requestIdentityKey = authIdentityKey;
      if (!requestIdentityKey) return;
      const requestKey = `${requestIdentityKey}\u001f${targetKey}`;
      let force = Boolean(options?.force);
      let forceToken = options?.forceToken;
      if (
        forceToken &&
        (activeForceTokenByKey.get(requestKey) === forceToken ||
          pendingForceTokenByKey.get(requestKey) === forceToken ||
          completedForceTokenByKey.get(requestKey) === forceToken)
      ) {
        return;
      }
      for (;;) {
        // Atomic claim: decide-and-mark in ONE updater against live store
        // state. Two hook instances mounting in the same commit both call in
        // here, but only the first updater run sees a non-loading entry.
        // Snapshot the ids known at claim time so the post-fetch merge can
        // tell an optimistic insert (added DURING the fetch — absent here)
        // from a row the server dropped (present here, missing from the
        // response) and must therefore evict.
        let claimed = false;
        let queuedForce = false;
        let knownIdsAtStart = new Set<string>();
        setEntries((previous) => {
          const stored = previous[targetKey];
          const entry =
            stored?.identityKey === requestIdentityKey ? stored : undefined;
          const decision = decideSessionCommentsFetch(entry, force, Date.now());
          if (decision !== "claim") {
            // A force behind an in-flight fetch is QUEUED, never dropped:
            // the running fetch's snapshot may predate the write this force
            // is meant to surface (terminal task states would stay stale
            // forever otherwise — nothing else refetches the embed).
            queuedForce = decision === "queue_force";
            return previous;
          }
          claimed = true;
          knownIdsAtStart = new Set(
            (entry?.comments ?? []).map((comment) => comment.id)
          );
          return writeSessionCommentsEntry(previous, targetKey, {
            ...(entry ?? EMPTY_ENTRY),
            identityKey: requestIdentityKey,
            state: "loading",
          });
        });
        if (!claimed) {
          if (queuedForce) {
            if (forceToken) {
              pendingForceTokenByKey.set(requestKey, forceToken);
            } else {
              pendingForceRefetchKeys.add(requestKey);
            }
          }
          return;
        }
        if (forceToken) activeForceTokenByKey.set(requestKey, forceToken);
        try {
          const accessToken = await withFreshToken();
          const currentAuth = authRef.current;
          if (
            !currentAuth ||
            org2CloudAuthIdentityKey(currentAuth) !== requestIdentityKey
          ) {
            dropPendingForce(requestKey);
            return;
          }
          const { comments, viewerOwnsSession } = await listSessionComments(
            accessToken,
            targetOrgId,
            targetSessionId
          );
          const latestAfterFetch = authRef.current;
          if (
            !latestAfterFetch ||
            org2CloudAuthIdentityKey(latestAfterFetch) !== requestIdentityKey
          ) {
            dropPendingForce(requestKey);
            return;
          }
          // MERGE, not wholesale-replace: preserve ONLY rows that appeared
          // locally AFTER the fetch was claimed (optimistic adds the server
          // snapshot predates — their id is not in knownIdsAtStart). A row
          // that WAS known at start but is missing from the response was
          // deleted server-side (e.g. GDPR erasure) and is dropped — merging
          // it back would make it immortal.
          setEntries((previous) => {
            const latestAuth = authRef.current;
            if (
              !latestAuth ||
              org2CloudAuthIdentityKey(latestAuth) !== requestIdentityKey
            ) {
              return previous;
            }
            const stored = previous[targetKey];
            const existing =
              stored?.identityKey === requestIdentityKey ? stored.comments : [];
            const fetchedIds = new Set(comments.map((comment) => comment.id));
            const merged = existing
              .filter(
                (comment) =>
                  !fetchedIds.has(comment.id) &&
                  !knownIdsAtStart.has(comment.id)
              )
              .reduce(
                (list, comment) => insertComment(list, comment),
                comments
              );
            return writeSessionCommentsEntry(previous, targetKey, {
              identityKey: requestIdentityKey,
              comments: merged,
              viewerOwnsSession,
              state: "ready",
              fetchedAt: Date.now(),
            });
          });
        } catch (error) {
          const latestAuth = authRef.current;
          if (
            !latestAuth ||
            org2CloudAuthIdentityKey(latestAuth) !== requestIdentityKey
          ) {
            dropPendingForce(requestKey);
            return;
          }
          log.warn("cloud_list_session_comments failed:", error);
          // Visibility revocation EVICTS the cached bodies (0002 invariant
          // 5 for already-cached data); transient failures keep them.
          const evict = shouldEvictSessionCommentsOnError(error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          setEntries((previous) =>
            writeSessionCommentsEntry(previous, targetKey, {
              ...(evict
                ? EMPTY_ENTRY
                : previous[targetKey]?.identityKey === requestIdentityKey
                  ? previous[targetKey]
                  : EMPTY_ENTRY),
              identityKey: requestIdentityKey,
              state: "error",
              errorMessage,
              fetchedAt: Date.now(),
            })
          );
        } finally {
          if (forceToken) {
            if (activeForceTokenByKey.get(requestKey) === forceToken) {
              activeForceTokenByKey.delete(requestKey);
            }
            rememberCompletedForceToken(requestKey, forceToken);
          }
        }
        // A force that arrived while THIS fetch was in flight replays as
        // exactly one more forced round-trip. Signal tokens additionally
        // collapse identical requests from multiple mounted subscribers.
        const queuedToken = pendingForceTokenByKey.get(requestKey);
        if (queuedToken) pendingForceTokenByKey.delete(requestKey);
        const queuedUntokened = pendingForceRefetchKeys.delete(requestKey);
        if (!queuedToken && !queuedUntokened) return;
        force = true;
        forceToken = queuedToken;
      }
    },
    [authIdentityKey, setEntries, withFreshToken]
  );

  useEffect(() => {
    if (!orgId || !sessionId || !signedIn) return;
    // TTL + in-flight dedup live inside fetchComments' atomic claim.
    void fetchComments(orgId, sessionId);
  }, [orgId, sessionId, signedIn, fetchComments]);

  const storedEntry = key ? entries[key] : undefined;
  const entry =
    sessionCommentsEntryForIdentity(storedEntry, authIdentityKey) ??
    EMPTY_ENTRY;
  const entryState = entry.state;

  const refresh = useCallback(() => {
    if (!orgId || !sessionId || !signedIn) return;
    void fetchComments(orgId, sessionId, { force: true });
  }, [orgId, sessionId, signedIn, fetchComments]);

  // Error retry: one deferred re-run per error result while a consumer is
  // mounted (the entry's fetchedAt changes on every attempt, re-arming the
  // effect). Not a recurring timer — it exists only while an error shows.
  const entryFetchedAt = entry.fetchedAt;
  useEffect(() => {
    if (!orgId || !sessionId || !signedIn) return undefined;
    if (entryState !== "error") return undefined;
    const timer = setTimeout(() => {
      void fetchComments(orgId, sessionId, {});
    }, SESSION_COMMENTS_ERROR_RETRY_MS);
    return () => clearTimeout(timer);
  }, [orgId, sessionId, signedIn, entryState, entryFetchedAt, fetchComments]);

  // --- Realtime nudge (comments bus): a peer's comment/task mutation
  // broadcast bumps this counter — force-refetch immediately so the open
  // thread streams. Event-driven only; no timer.
  const commentsSignal = useAtomValue(org2CloudCommentsSignalAtom);
  const signalVersion =
    orgId && sessionId
      ? (commentsSignal[sessionCommentsKey(orgId, sessionId)] ?? 0)
      : 0;
  const orgSignalVersion = orgId
    ? (commentsSignal[orgCommentsKey(orgId)] ?? 0)
    : 0;
  // Past generations are covered by the mount/TTL fetch. Seed from the
  // current counters so mounting a second surface never replays old signals.
  const lastSignalRef = useRef({
    session: signalVersion,
    org: orgSignalVersion,
  });
  useEffect(() => {
    if (!orgId || !sessionId || !signedIn) return;
    const sessionChanged = signalVersion !== lastSignalRef.current.session;
    const orgChanged = orgSignalVersion !== lastSignalRef.current.org;
    if (!sessionChanged && !orgChanged) return;
    lastSignalRef.current = {
      session: signalVersion,
      org: orgSignalVersion,
    };
    if (signalVersion === 0 && orgSignalVersion === 0) return;
    if (sessionChanged) {
      void fetchComments(orgId, sessionId, {
        force: true,
        forceToken: `session:${signalVersion}`,
      });
      return;
    }
    // org_change_signals carries unrelated projects, sessions, scopes, and
    // comments. Let the existing TTL gate this coarse fallback instead of forcing
    // every open session to list comments for every org-level write.
    void fetchComments(orgId, sessionId);
  }, [
    orgId,
    sessionId,
    signedIn,
    signalVersion,
    orgSignalVersion,
    fetchComments,
  ]);

  /** Apply a pure comments transform to the current entry. */
  const patchEntry = useCallback(
    (
      targetKey: string,
      transform: (comments: CloudSessionComment[]) => CloudSessionComment[]
    ) => {
      const identityKey = authIdentityKey;
      if (!identityKey) return;
      setEntries((previous) => {
        const latestAuth = authRef.current;
        if (
          !latestAuth ||
          org2CloudAuthIdentityKey(latestAuth) !== identityKey
        ) {
          return previous;
        }
        const stored = previous[targetKey];
        const entry =
          stored?.identityKey === identityKey ? stored : EMPTY_ENTRY;
        return writeSessionCommentsEntry(previous, targetKey, {
          ...entry,
          identityKey,
          comments: transform(entry.comments),
        });
      });
    },
    [authIdentityKey, setEntries]
  );

  const insertLocalComment = useCallback(
    (comment: CloudSessionComment): void => {
      if (!key) return;
      patchEntry(key, (comments) => insertComment(comments, comment));
    },
    [key, patchEntry]
  );

  const freshTokenForCurrentIdentity = useCallback(async () => {
    const identityKey = authIdentityKey;
    if (!identityKey) throw new Error("not signed in to ORG2 Cloud");
    const accessToken = await withFreshToken();
    const latestAuth = authRef.current;
    if (!latestAuth || org2CloudAuthIdentityKey(latestAuth) !== identityKey) {
      throw new Error("ORG2 Cloud identity changed during the request");
    }
    return { accessToken, identityKey };
  }, [authIdentityKey, withFreshToken]);

  const isCurrentIdentity = useCallback((identityKey: string): boolean => {
    const latestAuth = authRef.current;
    return Boolean(
      latestAuth && org2CloudAuthIdentityKey(latestAuth) === identityKey
    );
  }, []);

  const addComment = useCallback(
    async (input: AddCommentInput): Promise<CloudSessionComment> => {
      if (!orgId || !sessionId || !key) {
        throw new Error("no cloud comment target");
      }
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      const comment = await addSessionComment(accessToken, {
        orgId,
        sessionId,
        body: input.body,
        eventId: input.eventId,
        parentId: input.parentId,
        ...(originSessionId && originSessionId !== sessionId
          ? { originSessionId }
          : {}),
      });
      if (!isCurrentIdentity(identityKey)) return comment;
      // The RPC returns the row in listing shape — insert without a refetch.
      patchEntry(key, (comments) => insertComment(comments, comment));
      broadcastCommentsChangedToPeers(orgId, sessionId);
      return comment;
    },
    [
      orgId,
      sessionId,
      originSessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
    ]
  );

  const editComment = useCallback(
    async (commentId: string, body: string): Promise<void> => {
      if (!orgId || !key) throw new Error("no cloud comment target");
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      const editedAt = await editSessionComment(
        accessToken,
        orgId,
        commentId,
        body
      );
      if (!isCurrentIdentity(identityKey)) return;
      patchEntry(key, (comments) =>
        patchComment(comments, commentId, { body, editedAt })
      );
      if (sessionId) broadcastCommentsChangedToPeers(orgId, sessionId);
    },
    [
      orgId,
      sessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
    ]
  );

  const deleteComment = useCallback(
    async (commentId: string): Promise<void> => {
      if (!orgId || !key) throw new Error("no cloud comment target");
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      await deleteSessionComment(accessToken, orgId, commentId);
      if (!isCurrentIdentity(identityKey)) return;
      // Mirror the server's soft delete: stamp + blank body (tombstone).
      patchEntry(key, (comments) =>
        patchComment(comments, commentId, {
          deletedAt: new Date().toISOString(),
          body: "",
        })
      );
      if (sessionId) broadcastCommentsChangedToPeers(orgId, sessionId);
    },
    [
      orgId,
      sessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
    ]
  );

  const resolveComment = useCallback(
    async (
      commentId: string,
      resolved: boolean,
      resolution?: CloudCommentResolution
    ): Promise<void> => {
      if (!orgId || !key) throw new Error("no cloud comment target");
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      await resolveSessionComment(
        accessToken,
        orgId,
        commentId,
        resolved,
        resolution
      );
      if (!isCurrentIdentity(identityKey)) return;
      patchEntry(key, (comments) =>
        patchComment(comments, commentId, {
          resolvedAt: resolved ? new Date().toISOString() : undefined,
          resolution: resolved ? (resolution ?? "resolved") : undefined,
        })
      );
      if (sessionId) broadcastCommentsChangedToPeers(orgId, sessionId);
    },
    [
      orgId,
      sessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
    ]
  );

  return {
    comments: entry.comments,
    viewerOwnsSession: entry.viewerOwnsSession,
    state: entry.state,
    refresh,
    insertLocalComment,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
  };
}
