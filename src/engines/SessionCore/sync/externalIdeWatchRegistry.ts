/**
 * External IDE Live-Watch Registry
 *
 * Maps session ID prefixes to backend watch lifecycle hooks. The unified
 * `useExternalIdeSessionWatch` hook reads this registry to know which
 * sessions need a persistent backend watcher started on mount and stopped
 * on unmount (navigation away).
 *
 * To add a new live-watch IDE (e.g. Trae, a future Windsurf live mode):
 *   1. Add a `SessionLiveWatchHooks` entry below keyed by the session prefix.
 *   2. That's it — ChatView and `useExternalIdeSessionWatch` require no changes.
 */
import {
  cursorBridgeUnwatchComposer,
  cursorBridgeWatchComposer,
} from "@src/api/tauri/cursorBridge";
import type { SessionLiveWatchHooks } from "@src/util/session/sessionDispatch";
import { composerIdFromSessionId } from "@src/util/session/sessionDispatch";

/**
 * Registry keyed by session ID prefix (the part before the UUID).
 * Lookup via `getLiveWatchHooks(sessionId)`.
 */
const LIVE_WATCH_REGISTRY: Record<string, SessionLiveWatchHooks> = {
  "cursoride-": {
    async startWatch(sessionId: string): Promise<void> {
      const composerId = composerIdFromSessionId(sessionId);
      if (!composerId) return;
      await cursorBridgeWatchComposer({ sessionId, composerId });
    },
    async stopWatch(sessionId: string): Promise<void> {
      await cursorBridgeUnwatchComposer({ sessionId });
    },
  },
  // Future example:
  // "traeside-": {
  //   async startWatch(sessionId) { ... },
  //   async stopWatch(sessionId) { ... },
  // },
};

/**
 * Returns the live-watch hooks for the given session, or `null` if this
 * session type does not require a persistent backend watch.
 */
export function getLiveWatchHooks(
  sessionId: string
): SessionLiveWatchHooks | null {
  for (const prefix of Object.keys(LIVE_WATCH_REGISTRY)) {
    if (sessionId.startsWith(prefix)) {
      return LIVE_WATCH_REGISTRY[prefix] ?? null;
    }
  }
  return null;
}
