/** React-free "address comments" round: one in-place agent turn on the owning local session over every unresolved thread; the agent replies per thread via the reply_session_comment tool, with transcript parsing as fallback. */
import { atom } from "jotai";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { getSessionMetadata } from "@src/engines/SessionCore/storage/sqliteCache";
import { createLogger } from "@src/hooks/logger";
import { sessionByIdAtom } from "@src/store/session/sessionAtom/atoms";
import { TERMINAL_STATUSES } from "@src/types/session/session";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { stripCopyEventNamespace } from "../TeamCollaboration/copyEventId";
import {
  type AddressableThread,
  buildAddressCommentsBriefing,
  collectAddressableThreads,
  parseAddressReplies,
} from "./addressComments";
import {
  agentTaskRunnerSettingsAtom,
  resolveAgentRunnerSettings,
} from "./agentTaskRunnerSettingsAtom";
import { commitRefreshedAuth, org2CloudAuthAtom } from "./org2CloudAuthAtom";
import { ensureFreshSession } from "./org2CloudClient";
import { broadcastCommentsChanged } from "./org2CloudCommentsBus";
import {
  addSessionComment,
  listSessionComments,
} from "./org2CloudCommentsClient";

const log = createLogger("addressCommentsRun");

/** Sparse recovery check for a missed status-store notification. Normal
 * completion is event-driven through `sessionByIdAtom`. */
const STATUS_DEADMAN_INTERVAL_MS = 60_000;
const RUN_DEADLINE_MS = 15 * 60_000;
const FALLBACK_REPLY_MAX_CHARS = 4000;

export const addressRunActiveAtom = atom<Record<string, boolean>>({});
addressRunActiveAtom.debugLabel = "addressRunActiveAtom";

export interface ActiveAddressRun {
  orgId: string;
  cloudSessionId: string;
  localSessionId: string;
  validHeadIds: ReadonlySet<string>;
  holdReplyForCommentId?: string;
  heldBody?: string;
  replied: Map<string, string>;
}

const activeAddressRuns = new Map<string, ActiveAddressRun>();

async function waitForAddressRunTerminal(
  sessionId: string,
  deadlineMs: number,
  baselineEventCount: number
): Promise<void> {
  const store = getInstrumentedStore();
  const statusAtom = sessionByIdAtom(sessionId);
  // A REAL turn appends events; sendMessage's markSessionActive bumps the row
  // (new object, same terminal status) WITHOUT adding events. So the only
  // trustworthy "a new turn actually produced output" signal for a terminal
  // read is the persisted event count advancing past the pre-dispatch
  // baseline — object identity and status value both fail (they match the
  // pre-turn row), which is how a stale prior reply gets parsed.
  const eventsAdvanced = async (): Promise<boolean> =>
    ((await getSessionMetadata(sessionId).catch(() => undefined))?.eventCount ??
      0) > baselineEventCount;
  // One authoritative backend read closes the race where a fast turn completed
  // before the subscription installed — accept it only once new events prove a
  // turn ran (never on the pre-turn / markSessionActive terminal).
  const initial = await SessionService.getStatus({ sessionId });
  if (
    TERMINAL_STATUSES.has(String(initial.status)) &&
    (await eventsAdvanced())
  ) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    let observedActiveLocalStatus = false;

    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
    };
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const observeLocalStatus = (): boolean => {
      const status = store.get(statusAtom)?.status;
      if (!status) return false;
      if (!TERMINAL_STATUSES.has(String(status))) {
        observedActiveLocalStatus = true;
        return false;
      }
      // Settle on terminal ONLY after the turn was seen running. sendMessage's
      // markSessionActive emits a fresh terminal row before the agent starts;
      // requiring an observed non-terminal first is what keeps that pre-turn
      // terminal from being read as this turn's completion.
      if (!observedActiveLocalStatus) return false;
      settle();
      return true;
    };
    const scheduleDeadman = (): void => {
      if (settled) return;
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        settle(new Error("address-comments run timed out"));
        return;
      }
      timer = setTimeout(
        async () => {
          timer = null;
          try {
            const { status } = await SessionService.getStatus({ sessionId });
            if (
              TERMINAL_STATUSES.has(String(status)) &&
              (observedActiveLocalStatus || (await eventsAdvanced()))
            ) {
              settle();
              return;
            }
          } catch (error) {
            // A transient recovery-read failure must not abort an otherwise live
            // subscribed run. Keep waiting until the hard deadline.
            log.warn("address-comments status recovery check failed:", error);
          }
          scheduleDeadman();
        },
        Math.min(STATUS_DEADMAN_INTERVAL_MS, remainingMs)
      );
    };

    unsubscribe = store.sub(statusAtom, observeLocalStatus);
    const currentSession = store.get(statusAtom);
    if (
      currentSession?.status &&
      !TERMINAL_STATUSES.has(String(currentSession.status))
    ) {
      observedActiveLocalStatus = true;
    }
    scheduleDeadman();
  });
}

/**
 * Resolve the run that owns `commentId`, restricted to the run whose
 * `localSessionId` equals `invokingSessionId` (the trusted CallContext id of
 * the session whose agent called the reply tool). Fail-closed: an empty or
 * absent `invokingSessionId` matches nothing, so session A can never post
 * into session B's threads and an unbound call can never reach any run.
 */
function findActiveAddressRunForComment(
  commentId: string,
  invokingSessionId: string
): ActiveAddressRun | undefined {
  if (invokingSessionId.length === 0) return undefined;
  for (const run of activeAddressRuns.values()) {
    if (!run.validHeadIds.has(commentId)) continue;
    if (run.localSessionId !== invokingSessionId) continue;
    return run;
  }
  return undefined;
}

export interface AddressReplyToolResult {
  success: boolean;
  message: string;
}

/**
 * `session.replyComment` action backend — validates against the active run
 * registry. `invokingSessionId` is the trusted CallContext id of the session
 * whose agent issued the call; it binds the reply to that session's own run so
 * a foreign run's threads stay unreachable. Fail-closed: a missing/empty id is
 * rejected outright rather than scanning every active run.
 */
export async function replyViaActiveAddressRun(
  commentId: string,
  body: string,
  invokingSessionId?: string
): Promise<AddressReplyToolResult> {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return { success: false, message: "Reply body must not be empty." };
  }
  if (typeof invokingSessionId !== "string" || invokingSessionId.length === 0) {
    return {
      success: false,
      message:
        "Reply rejected: no invoking session id. The reply tool must run inside an active address-comments turn.",
    };
  }
  const run = findActiveAddressRunForComment(commentId, invokingSessionId);
  if (!run) {
    return {
      success: false,
      message: `Unknown commentId "${commentId}". Only reply to comment ids listed in the current instructions, during the run that provided them.`,
    };
  }
  if (run.replied.has(commentId)) {
    return {
      success: false,
      message: `A reply was already posted to comment ${commentId} in this run. Do not reply to the same comment twice.`,
    };
  }
  if (commentId === run.holdReplyForCommentId) {
    run.heldBody = trimmedBody;
    run.replied.set(commentId, trimmedBody);
    return {
      success: true,
      message: "Reply recorded; it will be delivered as this task's report.",
    };
  }
  const accessToken = await freshAccessToken();
  await addSessionComment(accessToken, {
    orgId: run.orgId,
    sessionId: run.cloudSessionId,
    body: trimmedBody,
    parentId: commentId,
    kind: "agent_report",
  });
  run.replied.set(commentId, trimmedBody);
  broadcastCommentsChanged(run.orgId, run.cloudSessionId);
  return { success: true, message: `Reply posted to comment ${commentId}.` };
}

const lastRoundReplies = new Map<string, Map<string, string>>();

export function getLastRoundReply(
  localSessionId: string,
  commentId: string
): string | undefined {
  return lastRoundReplies.get(localSessionId)?.get(commentId);
}

type AddressRunFinishedListener = () => void;
const addressRunFinishedListeners = new Set<AddressRunFinishedListener>();

export function registerAddressRunFinishedListener(
  listener: AddressRunFinishedListener
): () => void {
  addressRunFinishedListeners.add(listener);
  return () => {
    addressRunFinishedListeners.delete(listener);
  };
}

function notifyAddressRunFinished(): void {
  for (const listener of [...addressRunFinishedListeners]) {
    try {
      listener();
    } catch (error) {
      log.warn(`address-run finished listener threw: ${String(error)}`);
    }
  }
}

export function isAddressRunActive(localSessionId: string): boolean {
  return Boolean(
    getInstrumentedStore().get(addressRunActiveAtom)[localSessionId]
  );
}

function setAddressRunActive(localSessionId: string, active: boolean): void {
  getInstrumentedStore().set(addressRunActiveAtom, (current) => {
    if (active) return { ...current, [localSessionId]: true };
    if (!(localSessionId in current)) return current;
    const { [localSessionId]: _removed, ...rest } = current;
    return rest;
  });
}

async function freshAccessToken(): Promise<string> {
  const store = getInstrumentedStore();
  const current = store.get(org2CloudAuthAtom);
  if (!current) {
    throw new Error("org2 cloud sign-in required for an address-comments run");
  }
  const fresh = await ensureFreshSession(current);
  if (!fresh) {
    throw new Error("org2 cloud session refresh failed");
  }
  commitRefreshedAuth(
    (updater) => store.set(org2CloudAuthAtom, updater),
    current,
    fresh
  );
  return fresh.accessToken;
}

export interface AddressRoundEventLike {
  id: string;
  displayText?: string;
  source?: string;
}

export function attachAnchorExcerpts(
  threads: readonly AddressableThread[],
  events: readonly AddressRoundEventLike[],
  localSessionId?: string
): AddressableThread[] {
  // Threads anchor by SOURCE event id; a fork/import's local events carry
  // namespaced ids, so index in source-id space to match the anchors.
  const toSourceId = (id: string) =>
    localSessionId ? stripCopyEventNamespace(localSessionId, id) : id;
  const eventTextById = new Map<string, string>();
  const roundNumberByEventId = new Map<string, number>();
  const roundUserTextByNumber = new Map<number, string>();
  let roundNumber = 0;
  for (const event of events) {
    if (event.source === "user") {
      roundNumber += 1;
      if (event.displayText) {
        roundUserTextByNumber.set(roundNumber, event.displayText);
      }
    }
    if (roundNumber > 0) {
      roundNumberByEventId.set(toSourceId(event.id), roundNumber);
    }
    if (event.displayText) {
      eventTextById.set(toSourceId(event.id), event.displayText);
    }
  }
  return threads.map((thread) => {
    const eventId = thread.anchorEventId;
    if (!eventId) return thread;
    const anchorRoundNumber = roundNumberByEventId.get(eventId);
    const anchorExcerpt =
      (anchorRoundNumber !== undefined
        ? roundUserTextByNumber.get(anchorRoundNumber)
        : undefined) ?? eventTextById.get(eventId);
    if (anchorExcerpt === undefined) return thread;
    return {
      ...thread,
      anchorExcerpt,
      ...(anchorRoundNumber !== undefined ? { anchorRoundNumber } : {}),
    };
  });
}

export async function readRunSummaryFromEventStore(
  sessionId: string
): Promise<string | undefined> {
  const events = await eventStoreProxy.getPersistedEvents(sessionId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.source !== "assistant") continue;
    const actionType = event.actionType ?? "";
    if (
      actionType.includes("thinking") ||
      actionType.includes("reasoning") ||
      actionType.includes("tool")
    ) {
      continue;
    }
    const text = (event.displayText || "").trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export function partitionAddressReplies(
  replies: readonly { commentId: string; body: string }[],
  holdReplyForCommentId: string | undefined
): { toPost: { commentId: string; body: string }[]; heldReply?: string } {
  const toPost = replies.filter(
    (reply) => reply.commentId !== holdReplyForCommentId
  );
  const held = replies.find(
    (reply) => reply.commentId === holdReplyForCommentId
  );
  return {
    toPost,
    ...(held !== undefined ? { heldReply: held.body } : {}),
  };
}

export function selectFallbackReplies(
  summary: string,
  validIds: ReadonlySet<string>,
  replied: ReadonlyMap<string, string>,
  firstHeadId: string
): Array<{ commentId: string; body: string }> {
  const parsed = parseAddressReplies(summary, validIds).filter(
    (reply) => !replied.has(reply.commentId)
  );
  if (parsed.length === 0 && replied.size === 0 && summary.length > 0) {
    return [
      {
        commentId: firstHeadId,
        body: summary.slice(0, FALLBACK_REPLY_MAX_CHARS),
      },
    ];
  }
  return parsed;
}

export function seedActiveAddressRunForTest(run: ActiveAddressRun): () => void {
  activeAddressRuns.set(run.localSessionId, run);
  return () => {
    activeAddressRuns.delete(run.localSessionId);
  };
}

export interface AddressRoundInput {
  orgId: string;
  cloudSessionId: string;
  localSessionId: string;
  /**
   * Thread head whose parsed reply is HELD instead of posted — the caller
   * (in-place task runner) delivers it as the task's completion report
   * reply, so the thread never receives the same content twice.
   */
  holdReplyForCommentId?: string;
  /** Restrict the round to these thread heads; omitted = all unresolved. */
  selectedHeadIds?: readonly string[];
  /** Extra requester instruction appended to the briefing. */
  instruction?: string;
  /**
   * Post parsed replies as ordinary 'user' comments instead of 'agent_report'.
   * `agent_report` is server-restricted to the session OWNER, so a forker
   * running @agent on someone else's shared session (the personal @agent path)
   * posts as a normal member comment — any member may.
   */
  replyAsUser?: boolean;
}

export type AddressRoundResult =
  | { status: "skipped_active" }
  | { status: "no_threads" }
  | {
      status: "ran";
      threadCount: number;
      /** Replies actually POSTED (a held reply is not counted). */
      replyCount: number;
      summary: string;
      /** The held thread's parsed reply body, when one was produced. */
      heldReply?: string;
    };

export async function runAddressCommentsRound(
  input: AddressRoundInput
): Promise<AddressRoundResult> {
  const {
    orgId,
    cloudSessionId,
    localSessionId,
    holdReplyForCommentId,
    selectedHeadIds,
    instruction,
    replyAsUser,
  } = input;
  if (isAddressRunActive(localSessionId)) return { status: "skipped_active" };
  setAddressRunActive(localSessionId, true);
  lastRoundReplies.delete(localSessionId);
  try {
    const listToken = await freshAccessToken();
    const { comments } = await listSessionComments(
      listToken,
      orgId,
      cloudSessionId
    );
    let threads = collectAddressableThreads(comments);
    if (selectedHeadIds !== undefined) {
      const selected = new Set(selectedHeadIds);
      threads = threads.filter((thread) => selected.has(thread.headId));
    }
    if (threads.length === 0) return { status: "no_threads" };
    const anchorEvents = await eventStoreProxy
      .getPersistedEvents(localSessionId)
      .catch(() => []);
    threads = attachAnchorExcerpts(threads, anchorEvents, localSessionId);

    const validIds = new Set(threads.map((thread) => thread.headId));
    const run: ActiveAddressRun = {
      orgId,
      cloudSessionId,
      localSessionId,
      validHeadIds: validIds,
      ...(holdReplyForCommentId !== undefined ? { holdReplyForCommentId } : {}),
      replied: new Map(),
    };
    activeAddressRuns.set(localSessionId, run);

    const briefing = buildAddressCommentsBriefing(threads, instruction);
    const runnerSettings = resolveAgentRunnerSettings(
      getInstrumentedStore().get(agentTaskRunnerSettingsAtom),
      orgId
    );
    const baselineEventCount =
      (await getSessionMetadata(localSessionId).catch(() => undefined))
        ?.eventCount ?? 0;
    await SessionService.sendMessage({
      sessionId: localSessionId,
      content: briefing,
      mode: runnerSettings.mode,
      ...(runnerSettings.model !== undefined
        ? { model: runnerSettings.model }
        : {}),
      ...(runnerSettings.accountId !== undefined
        ? { accountId: runnerSettings.accountId }
        : {}),
    });
    await waitForAddressRunTerminal(
      localSessionId,
      Date.now() + RUN_DEADLINE_MS,
      baselineEventCount
    );

    const summary = (await readRunSummaryFromEventStore(localSessionId)) ?? "";
    const parsedReplies = selectFallbackReplies(
      summary,
      validIds,
      run.replied,
      threads[0].headId
    );
    const { toPost, heldReply } = partitionAddressReplies(
      parsedReplies,
      holdReplyForCommentId
    );
    const toolPostedCount =
      run.replied.size - (run.heldBody !== undefined ? 1 : 0);
    for (const reply of toPost) {
      const replyToken = await freshAccessToken();
      await addSessionComment(replyToken, {
        orgId,
        sessionId: cloudSessionId,
        body: reply.body,
        parentId: reply.commentId,
        ...(replyAsUser ? {} : { kind: "agent_report" }),
      });
      run.replied.set(reply.commentId, reply.body);
    }
    broadcastCommentsChanged(orgId, cloudSessionId);
    const effectiveHeldReply = run.heldBody ?? heldReply;
    const postedCount = toolPostedCount + toPost.length;
    const roundReplies = new Map(run.replied);
    // Constraint: only POSTED replies may be cached for priorRoundReply reuse.
    // The held reply is delivered as the task's completion report, not posted
    // to the thread — caching it would let a failed-completion retry take the
    // reuse path and mark the task done with the answer never posted anywhere.
    if (holdReplyForCommentId !== undefined) {
      roundReplies.delete(holdReplyForCommentId);
    }
    lastRoundReplies.set(localSessionId, roundReplies);
    log.info(
      `address round on ${localSessionId}: ${threads.length} thread(s), ${postedCount} posted repl(ies)${effectiveHeldReply !== undefined ? ", 1 held" : ""}`
    );
    return {
      status: "ran",
      threadCount: threads.length,
      replyCount: postedCount,
      summary,
      ...(effectiveHeldReply !== undefined
        ? { heldReply: effectiveHeldReply }
        : {}),
    };
  } finally {
    activeAddressRuns.delete(localSessionId);
    setAddressRunActive(localSessionId, false);
    notifyAddressRunFinished();
  }
}
