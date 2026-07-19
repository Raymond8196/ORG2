/**
 * SessionCommentsContext — one comments state per mounted chat surface
 * (design session-comments-design-0707 §4).
 *
 * The provider lives in ChatView (which owns the Session object AND the
 * replay event stream) and resolves the cloud comment target once; the
 * per-turn chrome inside the virtualized transcript consumes the context
 * instead of re-running target resolution + atom subscriptions per group
 * header. NON-cloud sessions get a null context value — every consumer
 * renders nothing, so the ordinary chat surface is untouched.
 *
 * Context (not a global atom) on purpose: multiple ChatViews can be
 * mounted at once (split panes / editor tabs) and each needs its own
 * target. The one cross-tree bridge — the replay stream's event-id set,
 * needed by the HEADER notes dialog to bucket orphaned anchors — is a
 * session-id-keyed registry atom written here and read by
 * `SessionCommentsHeaderExtras` (the header renders outside ChatView).
 */
import { atom, useAtomValue, useSetAtom } from "jotai";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
} from "react";

import { createLogger } from "@src/hooks/logger";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import { stripCopyEventNamespace } from "../../TeamCollaboration/copyEventId";
import { getSessionForkedFrom } from "../../TeamCollaboration/forkSession";
import { collectAddressableThreads } from "../addressComments";
import {
  addressRunActiveAtom,
  runAddressCommentsRound,
} from "../addressCommentsRun";
import { org2CloudAuthAtom } from "../org2CloudAuthAtom";
import type { CloudCommentTask } from "../org2CloudCommentTasksClient";
import type {
  CloudCommentResolution,
  CloudSessionComment,
} from "../org2CloudCommentsClient";
import { org2CloudOrgsAtom } from "../org2CloudOrgsAtom";
import { org2CloudRemoteSessionsAtom } from "../org2CloudRemoteSessionsAtom";
import {
  type AddCommentInput,
  type CloudSessionCommentsFetchState,
  type GroupedCommentThreads,
  groupCommentThreads,
  useSessionComments,
} from "../org2CloudSessionCommentsAtom";
import {
  type SessionCommentTarget,
  useSessionCommentTarget,
} from "../sessionCommentTarget";

const log = createLogger("SessionComments");

const CLOUD_ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Replay-stream event ids per LOCAL session id, registered by every mounted
 * provider — keyed session id → PROVIDER INSTANCE id → id set, because two
 * panes can show the SAME session (split panes / editor tabs) and a single
 * slot per session would let whichever pane unmounts first delete the
 * surviving pane's entry (silently emptying the header dialog's orphan
 * bucket). Readers merge the instances via `mergePresentEventIdEntries`;
 * a missing/empty session entry means "presence unknown" and
 * `groupCommentThreads` then never classifies orphans.
 */
export const sessionCommentPresentEventIdsAtom = atom<
  Record<string, Record<string, ReadonlySet<string>>>
>({});
sessionCommentPresentEventIdsAtom.debugLabel =
  "sessionCommentPresentEventIdsAtom";

export interface SessionCommentsContextValue {
  target: SessionCommentTarget;
  state: CloudSessionCommentsFetchState;
  grouped: GroupedCommentThreads;
  /**
   * Map a local (possibly fork/import-namespaced) event id to the source-plane
   * event id comments anchor by. Identity for ordinary sessions.
   */
  toSourceEventId: (eventId: string) => string;
  /**
   * False when the rendered transcript is not this session's own stream
   * (group-chat merged view) — TurnCommentChrome renders nothing.
   */
  turnAnchorsVisible: boolean;
  /**
   * False when the cloud row says the session is NOT full_replay —
   * turn-anchored composers disable with a tooltip (the server enforces
   * regardless; UI mirrors it). Unknown rows default to true.
   */
  canAnchorTurns: boolean;
  viewerUserId: string | null;
  /** Org admin/owner — may delete any comment (moderation surface). */
  viewerIsAdmin: boolean;
  refresh: () => void;
  addComment: (input: AddCommentInput) => Promise<CloudSessionComment>;
  /**
   * Batch follow-up (design 2026-07-11): address every unresolved thread
   * IN PLACE as one agent round on the open writable session, then post
   * one parsed reply per thread. Null ⇒ not available here (read-only
   * replay or nothing unresolved).
   */
  addressAllComments: (() => Promise<void>) | null;
  addressRunActive: boolean;
  unresolvedThreadCount: number;
  editComment: (commentId: string, body: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  resolveComment: (
    commentId: string,
    resolved: boolean,
    resolution?: CloudCommentResolution
  ) => Promise<void>;

  // ---- Agent tasks (0002, agent-pickup design §4 items 1+4) ------------
  /** The thread head's task (UNIQUE comment_id ⇒ at most one). */
  taskForThread: (commentId: string) => CloudCommentTask | undefined;
  /**
   * Fail-open like `canAnchorTurns`: the server is the real gate
   * (readable guard + `forkSharedSessionEnabled` at claim). False only on
   * the one locally-KNOWN blocker — no signed-in cloud user.
   */
  canRunTasks: boolean;
  /** Run a personal @agent round for this comment on the local session. */
  createTask: (commentId: string, instruction?: string) => Promise<void>;
}

const SessionCommentsContext =
  createContext<SessionCommentsContextValue | null>(null);

export function useSessionCommentsContext(): SessionCommentsContextValue | null {
  return useContext(SessionCommentsContext);
}

/**
 * Viewer-side capability probes shared by the provider and the header
 * extras (which runs its own instance because it mounts outside ChatView).
 */
export function useSessionCommentViewer(target: SessionCommentTarget | null): {
  viewerUserId: string | null;
  viewerIsAdmin: boolean;
  canAnchorTurns: boolean;
} {
  const auth = useAtomValue(org2CloudAuthAtom);
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);
  const remoteEntries = useAtomValue(org2CloudRemoteSessionsAtom);

  return useMemo(() => {
    const role = target
      ? cloudOrgs.find((org) => org.orgId === target.orgId)?.role
      : undefined;
    const row = target
      ? remoteEntries[target.orgId]?.rows.find(
          (candidate) => candidate.sourceSessionId === target.sessionId
        )
      : undefined;
    return {
      viewerUserId: auth?.userId ?? null,
      viewerIsAdmin: Boolean(role && CLOUD_ADMIN_ROLES.has(role)),
      // Row unknown (listing not fetched yet) fails OPEN — the server is
      // the real gate (ORG2_REPLAY_NOT_AVAILABLE) and a stale disable
      // would block legitimate anchors.
      canAnchorTurns: row?.accessMode
        ? row.accessMode === COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
        : true,
    };
  }, [target, auth, cloudOrgs, remoteEntries]);
}

export interface SessionCommentsProviderProps {
  session: Session | null | undefined;
  /**
   * Events currently present in the replay stream (anchor presence for
   * orphan bucketing). `null` = presence UNKNOWN (snapshot not hydrated
   * yet) — threads must not be bucketed as orphans off an empty pre-load
   * set. Only the ids are read, and only for cloud targets — ordinary
   * sessions never pay the id-set build.
   */
  events: readonly { id: string }[] | null;
  /**
   * False when the rendered transcript is NOT this session's own stream
   * (agent-org group-chat view merges member-session events, whose ids can
   * never anchor into THIS session) — turn chrome hides; the header Notes
   * dialog stays available.
   */
  turnAnchorsVisible?: boolean;
  children: React.ReactNode;
}

export const SessionCommentsProvider: React.FC<
  SessionCommentsProviderProps
> = ({ session, events, turnAnchorsVisible = true, children }) => {
  const target = useSessionCommentTarget(session);
  // Comments live on the SOURCE session's plane, anchored by the raw source
  // event id shared across all users. A fork/import copy carries namespaced
  // local ids, so anchor matching must happen in source-id space.
  const localSessionId = target ? (session?.session_id ?? null) : null;
  // Origin attribution is for per-fork counts, so it is stamped ONLY for a
  // writable fork. An import (read-only replay) or a plain tagged session must
  // not create a bogus origin bucket — they coalesce to the source at count
  // time.
  const originSessionId =
    session && getSessionForkedFrom(session) ? localSessionId : null;
  const toSourceEventId = useCallback(
    (eventId: string) =>
      localSessionId
        ? stripCopyEventNamespace(localSessionId, eventId)
        : eventId,
    [localSessionId]
  );
  const presentEventIds = useMemo<ReadonlySet<string> | null>(
    () =>
      target && events
        ? new Set(events.map((event) => toSourceEventId(event.id)))
        : null,
    [target, events, toSourceEventId]
  );
  const {
    comments,
    state,
    refresh,
    taskForThread,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
  } = useSessionComments(
    target?.orgId ?? null,
    target?.sessionId ?? null,
    originSessionId
  );
  const viewer = useSessionCommentViewer(target);
  const setPresentRegistry = useSetAtom(sessionCommentPresentEventIdsAtom);

  // Publish the replay stream's event ids for the header notes dialog —
  // only for cloud targets, so ordinary sessions cause zero registry churn.
  // Keyed by PROVIDER INSTANCE under the session id: two panes on the same
  // session each own their sub-entry, so the first pane to unmount can
  // never delete the surviving pane's ids (readers union the instances).
  const providerId = useId();
  useEffect(() => {
    if (!localSessionId || !presentEventIds) return;
    setPresentRegistry((previous) => ({
      ...previous,
      [localSessionId]: {
        ...previous[localSessionId],
        [providerId]: presentEventIds,
      },
    }));
    return () => {
      setPresentRegistry((previous) => {
        const forSession = previous[localSessionId];
        if (!forSession || !(providerId in forSession)) return previous;
        const { [providerId]: _removed, ...restInstances } = forSession;
        if (Object.keys(restInstances).length === 0) {
          const { [localSessionId]: _session, ...restSessions } = previous;
          return restSessions;
        }
        return { ...previous, [localSessionId]: restInstances };
      });
    };
  }, [localSessionId, presentEventIds, providerId, setPresentRegistry]);

  const grouped = useMemo(
    () => groupCommentThreads(comments, presentEventIds),
    [comments, presentEventIds]
  );

  const createTask = useCallback(
    async (commentId: string, instruction?: string): Promise<void> => {
      if (!target || !session) throw new Error("no cloud comment target");
      // Personal @agent: run a scoped agent round on THIS machine's local
      // session (a fork of the shared source) for just this comment, and post
      // the answer back as an ordinary member reply (replyAsUser — a forker
      // isn't the source owner, so it can't post an agent_report). No cloud
      // task / lease / pickup: a teammate's @agent runs on THEIR machine, never
      // here. Fire in the background so the composer submit doesn't block on the
      // whole agent turn — addressRunActive reflects the in-flight state and the
      // refetch surfaces the reply.
      void runAddressCommentsRound({
        orgId: target.orgId,
        cloudSessionId: target.sessionId,
        localSessionId: session.session_id,
        selectedHeadIds: [commentId],
        replyAsUser: true,
        ...(instruction !== undefined ? { instruction } : {}),
      })
        .then(() => refresh())
        .catch((error) => {
          log.warn(
            `personal @agent round failed for ${commentId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
    },
    [target, session, refresh]
  );

  // --- Address comments (batch in-place follow-up) ---
  const addressRunActiveMap = useAtomValue(addressRunActiveAtom);
  const addressRunActive = Boolean(
    localSessionId && addressRunActiveMap[localSessionId]
  );
  const addressableThreads = useMemo(
    () => collectAddressableThreads(comments),
    [comments]
  );
  const unresolvedThreadCount = addressableThreads.length;
  // Imported replays are read-only, so in-place runs are excluded for them.
  const canAddressInPlace = Boolean(
    session && !session.importedFrom && target && unresolvedThreadCount > 0
  );

  const addressAllCommentsImpl = useCallback(async (): Promise<void> => {
    if (!target || !session) return;
    await runAddressCommentsRound({
      orgId: target.orgId,
      cloudSessionId: target.sessionId,
      localSessionId: session.session_id,
    });
    refresh();
  }, [target, session, refresh]);

  const value = useMemo<SessionCommentsContextValue | null>(() => {
    if (!target) return null;
    return {
      target,
      state,
      grouped,
      toSourceEventId,
      turnAnchorsVisible,
      canAnchorTurns: viewer.canAnchorTurns,
      viewerUserId: viewer.viewerUserId,
      viewerIsAdmin: viewer.viewerIsAdmin,
      refresh,
      addComment,
      editComment,
      deleteComment,
      resolveComment,
      taskForThread,
      // Fail-open (the server gates membership/entitlement/readable); the
      // one locally-KNOWN blocker is a missing cloud sign-in.
      canRunTasks: viewer.viewerUserId !== null,
      createTask,
      addressAllComments: canAddressInPlace ? addressAllCommentsImpl : null,
      addressRunActive,
      unresolvedThreadCount,
    };
  }, [
    target,
    state,
    grouped,
    toSourceEventId,
    turnAnchorsVisible,
    viewer,
    refresh,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
    taskForThread,
    createTask,
    canAddressInPlace,
    addressAllCommentsImpl,
    addressRunActive,
    unresolvedThreadCount,
  ]);

  return (
    <SessionCommentsContext.Provider value={value}>
      {children}
    </SessionCommentsContext.Provider>
  );
};
