/**
 * useExternalIdeSessionWatch
 *
 * Unified lifecycle hook for IDE session types that require a persistent
 * backend watch (e.g. Cursor CDP WebSocket). Mount → startWatch, unmount
 * (navigation away or session switch) → stopWatch.
 *
 * The set of session types that need a watch is declared in
 * `externalIdeWatchRegistry.ts`. Adding a new IDE requires only a registry
 * entry — this hook and its call site in ChatView need no changes.
 *
 * Behaviour:
 * - No-op for session types not present in the registry.
 * - Calling startWatch is best-effort: failures are logged but do not throw,
 *   because the polling fallback (CursorIdeFocusPoller etc.) still provides
 *   eventual consistency for the final answer state.
 * - stopWatch is always attempted on unmount, even if startWatch failed,
 *   to guarantee the Rust side is clean.
 */
import { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";

import { getLiveWatchHooks } from "./externalIdeWatchRegistry";

const logger = createLogger("ExternalIdeSessionWatch");

export function useExternalIdeSessionWatch(sessionId: string): void {
  useEffect(() => {
    const hooks = getLiveWatchHooks(sessionId);
    if (!hooks) return;

    let stopped = false;

    hooks.startWatch(sessionId).catch((err: unknown) => {
      if (!stopped) {
        logger.warn(`startWatch failed for ${sessionId}:`, err);
      }
    });

    return () => {
      stopped = true;
      hooks.stopWatch(sessionId).catch((err: unknown) => {
        logger.warn(`stopWatch failed for ${sessionId}:`, err);
      });
    };
  }, [sessionId]);
}
