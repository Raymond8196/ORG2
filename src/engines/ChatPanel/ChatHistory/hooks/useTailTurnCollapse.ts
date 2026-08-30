import { useEffect, useMemo, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isExternalHistorySession } from "@src/util/session/sessionDispatch";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";

import type { GroupChatContextValue } from "../GroupChatView/GroupChatContext";
import { isAgentOrgInboxTranscriptEvent } from "../GroupChatView/groupChatUtils";

export const TAIL_TURN_COLLAPSE_IDLE_MS = 60_000;

/**
 * A session whose last event is older than this is treated as finished: its
 * tail turn DEFAULTS to collapsed (no size threshold), matching historical
 * turns. Explicit per-turn overrides still win.
 */
export const TAIL_TURN_STALE_MS = 10 * 60_000;

export function findTailTurnId(
  chatHistory: SessionEvent[],
  groupChat: GroupChatContextValue | null
): string | null {
  for (let index = chatHistory.length - 1; index >= 0; index--) {
    const event = chatHistory[index];
    if (!event?.id) continue;
    if (groupChat?.enabled) {
      if (groupChat.isCoordinatorTurnHeader(event)) return event.id;
      continue;
    }
    if (event.source === "user" && !isAgentOrgInboxTranscriptEvent(event)) {
      return event.id;
    }
  }
  return null;
}

interface UseTailTurnCollapseOptions {
  activeId: string | null;
  chatHistory: SessionEvent[];
  disableTailCollapse: boolean;
  groupChat: GroupChatContextValue | null;
  isAgentWorking: boolean;
  isCursorIde: boolean;
  sessionStatus: string | undefined;
}

interface ResolveTailTurnAgentWorkingOptions {
  activeId: string | null;
  isAgentWorking: boolean;
  sessionStatus: string | undefined;
}

/**
 * External-history rows get their live state from the normalized Session
 * status that also drives the sidebar dot. The foreground runtime atom is
 * authoritative for native sessions, but it does not track an independently
 * running Codex/Claude process.
 */
export function resolveTailTurnAgentWorking({
  activeId,
  isAgentWorking,
  sessionStatus,
}: ResolveTailTurnAgentWorkingOptions): boolean {
  if (!isExternalHistorySession(activeId)) return isAgentWorking;
  return isSessionInProgress(sessionStatus);
}

export function useTailTurnCollapse({
  activeId,
  chatHistory,
  disableTailCollapse,
  groupChat,
  isAgentWorking,
  isCursorIde,
  sessionStatus,
}: UseTailTurnCollapseOptions): boolean {
  const [tailIdleReadyKey, setTailIdleReadyKey] = useState<string | null>(null);
  const tailTurnId = useMemo(
    () => findTailTurnId(chatHistory, groupChat),
    [chatHistory, groupChat]
  );
  const tailTurnAgentWorking = resolveTailTurnAgentWorking({
    activeId,
    isAgentWorking,
    sessionStatus,
  });
  const tailIdleKey =
    !tailTurnAgentWorking && !isCursorIde && activeId && tailTurnId
      ? `${activeId}:${tailTurnId}`
      : null;

  useEffect(() => {
    if (!tailIdleKey) return;

    const timeoutId = window.setTimeout(() => {
      setTailIdleReadyKey(tailIdleKey);
    }, TAIL_TURN_COLLAPSE_IDLE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [tailIdleKey]);

  return (
    !disableTailCollapse &&
    tailIdleKey !== null &&
    tailIdleReadyKey === tailIdleKey
  );
}

interface UseTailTurnStaleOptions {
  activeId: string | null;
  chatHistory: SessionEvent[];
  disableTailCollapse: boolean;
}

/**
 * True once the session's newest event is older than `TAIL_TURN_STALE_MS`.
 * Already-stale sessions (reopened after the fact) report true immediately;
 * live sessions arm a timer for the remaining window, and any new event
 * re-arms it. Wall-clock based on the event's own timestamp, no exclusions.
 */
export function useTailTurnStale({
  activeId,
  chatHistory,
  disableTailCollapse,
}: UseTailTurnStaleOptions): boolean {
  const [staleReadyKey, setStaleReadyKey] = useState<string | null>(null);
  const lastEventMs = useMemo(() => {
    for (let index = chatHistory.length - 1; index >= 0; index--) {
      const iso = chatHistory[index]?.createdAt;
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms)) return ms;
    }
    return null;
  }, [chatHistory]);
  const staleKey =
    !disableTailCollapse && activeId && lastEventMs !== null
      ? `${activeId}:${lastEventMs}`
      : null;

  useEffect(() => {
    if (!staleKey || lastEventMs === null) return;

    const remainingMs = lastEventMs + TAIL_TURN_STALE_MS - Date.now();
    if (remainingMs <= 0) {
      setStaleReadyKey(staleKey);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setStaleReadyKey(staleKey);
    }, remainingMs);

    return () => window.clearTimeout(timeoutId);
  }, [staleKey, lastEventMs]);

  return staleKey !== null && staleReadyKey === staleKey;
}
