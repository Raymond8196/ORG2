import { useEffect } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import type { SessionSyncRefs } from "./sessionSyncTypes";
import { EVENT_STORE_CACHE_SYNC_INTERVAL_MS } from "./sessionSyncUtils";

function saveSessionEventsToCache(sessionId: string): void {
  if (isImportedHistorySession(sessionId)) return;
  eventStoreProxy.saveToCache(sessionId);
}

export function useEventStoreCacheSync(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId || isImportedHistorySession(sessionId)) return;

    // Dirty-check gate. The previous unconditional tick serialized the whole
    // event store and wrote SQLite every 30s even for a fully idle, unchanged
    // session — the single largest source of idle-session background work.
    // The snapshot `version` is monotonic per applied envelope, so an
    // unchanged session keeps the same value and we can skip the write.
    // This hook only runs for the active session (SessionSyncProvider), which
    // always has a live snapshot and is never LRU-evicted, so a null version
    // means "still loading" rather than "evicted" — nothing to persist.
    let lastSavedVersion: number | null = null;

    const tick = (): void => {
      const version =
        eventStoreProxy.getLatestSessionSnapshot(sessionId)?.version ?? null;
      if (version === null || version === lastSavedVersion) return;
      lastSavedVersion = version;
      saveSessionEventsToCache(sessionId);
    };

    const interval = setInterval(tick, EVENT_STORE_CACHE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId]);
}

export function useSessionSyncCleanup(
  refs: Pick<SessionSyncRefs, "prevSessionIdRef" | "handlerRef">
): void {
  useEffect(() => {
    return () => {
      if (refs.prevSessionIdRef.current) {
        saveSessionEventsToCache(refs.prevSessionIdRef.current);
      }
      if (refs.handlerRef.current) {
        refs.handlerRef.current.dispose();
        refs.handlerRef.current = null;
      }
    };
  }, [refs.handlerRef, refs.prevSessionIdRef]);
}

export function disposeCurrentHandler(
  refs: Pick<SessionSyncRefs, "handlerRef">
): void {
  if (refs.handlerRef.current) {
    refs.handlerRef.current.dispose();
    refs.handlerRef.current = null;
  }
}

export function resetReloadGuardForSession(
  sessionId: string,
  refs: Pick<SessionSyncRefs, "prevSessionIdRef" | "prevReloadEpochRef">
): void {
  if (refs.prevSessionIdRef.current === sessionId) {
    refs.prevSessionIdRef.current = null;
    refs.prevReloadEpochRef.current = 0;
  }
}
