import { useEffect } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import { getAdapterForSession } from "./types";

const logger = createLogger("ExternalHistoryAutoRefresh");

type DispatchSessionLoad = (payload: {
  sessionId: string;
  events: SessionEvent[];
}) => void;

/** Re-read one imported transcript without rescanning every provider cache. */
export async function refreshImportedHistorySession(
  sessionId: string,
  signal: AbortSignal,
  dispatchLoadSession: DispatchSessionLoad
): Promise<boolean> {
  if (!isImportedHistorySession(sessionId)) return false;
  const adapter = getAdapterForSession(sessionId);
  if (!adapter || adapter.category !== "external_history") return false;

  const events = await adapter.loadHistory(sessionId, signal);
  if (signal.aborted || events.length === 0) return false;
  dispatchLoadSession({ sessionId, events });
  return true;
}

export function useExternalHistoryAutoRefresh(options: {
  sessionId: string | null;
  intervalMs: number;
  dispatchLoadSession: DispatchSessionLoad;
}): void {
  const { sessionId, intervalMs, dispatchLoadSession } = options;

  useEffect(() => {
    if (!sessionId || !isImportedHistorySession(sessionId)) return;

    let refreshRunning = false;
    let activeController: AbortController | null = null;
    const refresh = async () => {
      if (refreshRunning) return;
      refreshRunning = true;
      activeController = new AbortController();
      try {
        await refreshImportedHistorySession(
          sessionId,
          activeController.signal,
          dispatchLoadSession
        );
      } catch (error) {
        if (!activeController.signal.aborted) {
          logger.warn(`Failed to refresh ${sessionId}:`, error);
        }
      } finally {
        refreshRunning = false;
        activeController = null;
      }
    };

    const intervalId = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, [dispatchLoadSession, intervalMs, sessionId]);
}
