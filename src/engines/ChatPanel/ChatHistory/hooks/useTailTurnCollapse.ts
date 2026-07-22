import { useEffect, useMemo, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { GroupChatContextValue } from "../GroupChatView/GroupChatContext";
import { isAgentOrgInboxTranscriptEvent } from "../GroupChatView/groupChatUtils";

export const TAIL_TURN_COLLAPSE_IDLE_MS = 60_000;

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
}

export function useTailTurnCollapse({
  activeId,
  chatHistory,
  disableTailCollapse,
  groupChat,
  isAgentWorking,
  isCursorIde,
}: UseTailTurnCollapseOptions): boolean {
  const [tailIdleReadyKey, setTailIdleReadyKey] = useState<string | null>(null);
  const tailTurnId = useMemo(
    () => findTailTurnId(chatHistory, groupChat),
    [chatHistory, groupChat]
  );
  const tailIdleKey =
    !isAgentWorking && !isCursorIde && activeId && tailTurnId
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
