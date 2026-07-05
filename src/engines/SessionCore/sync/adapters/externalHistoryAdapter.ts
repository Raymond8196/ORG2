import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { createLogger } from "@src/hooks/logger";

import type {
  AdapterSendInput,
  EventHandlerCallbacks,
  SessionAdapter,
  SessionEventHandler,
} from "../types";

const logger = createLogger("ExternalHistoryAdapter");
const EXTERNAL_HISTORY_INITIAL_CHUNK_LIMIT = 200;

function createNoopEventHandler(): SessionEventHandler {
  return {
    handleEvent(): void {},
    reset(): void {},
    get isStreaming() {
      return false;
    },
    dispose(): void {},
  };
}

async function loadExternalHistory(
  sessionId: string,
  signal: AbortSignal
): Promise<SessionEvent[]> {
  const source = getImportedHistorySourceBySessionId(sessionId);
  if (!source) {
    logger.warn("No external history loader registered for session", sessionId);
    return [];
  }
  const chunks = await source.loadChunks(sessionId);
  if (signal.aborted || !Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }
  const initialWindow = chunks.slice(-EXTERNAL_HISTORY_INITIAL_CHUNK_LIMIT);
  const events = await processChunksRust(initialWindow, sessionId);
  if (signal.aborted) return [];
  return events;
}

export const externalHistoryAdapter: SessionAdapter = {
  category: "external_history",

  loadHistory: loadExternalHistory,

  async postLoad() {
    return { runStatus: "completed" };
  },

  createEventHandler(
    _sessionId: string,
    _callbacks: EventHandlerCallbacks
  ): SessionEventHandler {
    return createNoopEventHandler();
  },

  async sendMessage(input: AdapterSendInput): Promise<void> {
    throw new Error(
      `External history sessions are read-only and cannot receive messages (${input.sessionId}).`
    );
  },

  async stopSession(): Promise<void> {},
};
