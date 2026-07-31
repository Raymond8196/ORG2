import { importedHistoryTurnWindows } from "@src/api/tauri/externalHistory";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import {
  isCodexAppSession,
  isCursorIdeSession,
  isExternalHistorySession,
} from "@src/util/session/sessionDispatch";

import type { SessionTurnLoader } from "./types";

interface PendingImportedTurnBatch {
  turnIds: Set<string>;
  waiters: Array<{
    resolve: (loaded: boolean) => void;
    reject: (error: unknown) => void;
  }>;
  flushing: boolean;
}

const pendingBatches = new Map<string, PendingImportedTurnBatch>();

async function flushPendingBatch(sessionId: string): Promise<void> {
  const batch = pendingBatches.get(sessionId);
  if (!batch || batch.flushing) return;
  batch.flushing = true;

  while (batch.turnIds.size > 0) {
    const turnIds = [...batch.turnIds];
    const waiters = batch.waiters.splice(0);
    batch.turnIds.clear();

    try {
      const windows = await importedHistoryTurnWindows({
        sessionId,
        turnIds,
      });
      const chunks = windows.flatMap((window) => window.chunks);
      // Batch-level resolution: per-turn attribution is not available on
      // this wire, but provider files are local so an empty window means
      // the whole batch found nothing.
      let loaded = false;
      if (chunks.length > 0) {
        const events = await processChunksRust(chunks, sessionId);
        if (events.length > 0) {
          await eventStoreProxy.mergeRoundWindowEvents(events, sessionId);
          loaded = true;
        }
      }
      for (const waiter of waiters) waiter.resolve(loaded);
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    }
  }

  pendingBatches.delete(sessionId);
}

function enqueueImportedTurnLoad(
  sessionId: string,
  turnId: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const existing = pendingBatches.get(sessionId);
    if (existing) {
      existing.turnIds.add(turnId);
      existing.waiters.push({ resolve, reject });
      return;
    }

    pendingBatches.set(sessionId, {
      turnIds: new Set([turnId]),
      waiters: [{ resolve, reject }],
      flushing: false,
    });
    queueMicrotask(() => {
      void flushPendingBatch(sessionId);
    });
  });
}

export const importedHistoryTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    if (
      !isExternalHistorySession(sessionId) ||
      isCodexAppSession(sessionId) ||
      isCursorIdeSession(sessionId)
    ) {
      return false;
    }
    return enqueueImportedTurnLoad(sessionId, turnId);
  },
};
