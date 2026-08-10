import type { CanvasInlinePayload } from "@src/engines/ChatPanel/blocks/CanvasInlineCard/types";

import {
  type CanvasShareLinkResult,
  type CanvasShareSnapshotV1,
  buildCanvasShareLink,
  createCanvasShareEnvelope,
} from "./canvasShareProtocol";

const MAX_CACHE_ENTRIES = 16;
const MAX_RETAINED_CHARACTERS = 1024 * 1024;

type CanvasShareCacheKey = CanvasShareSnapshotV1;

interface CanvasShareCacheEntryBase {
  token: symbol;
  key: CanvasShareCacheKey;
  retainedCharacters: number;
}

interface PendingCanvasShareCacheEntry extends CanvasShareCacheEntryBase {
  phase: "pending";
  promise: Promise<CanvasShareLinkResult>;
  controller: AbortController;
}

interface ReadyCanvasShareCacheEntry extends CanvasShareCacheEntryBase {
  phase: "ready";
  result: CanvasShareLinkResult;
}

type CanvasShareCacheEntry =
  | PendingCanvasShareCacheEntry
  | ReadyCanvasShareCacheEntry;

type CanvasShareCacheLookup =
  | { phase: "pending"; promise: Promise<CanvasShareLinkResult> }
  | { phase: "ready"; result: CanvasShareLinkResult };

// App-runtime LRU. Canvas tabs intentionally unmount when inactive, so the
// successful immutable link must live above any individual tab component.
const entries: CanvasShareCacheEntry[] = [];

function cacheKeyFor(payload: CanvasInlinePayload): CanvasShareCacheKey {
  return createCanvasShareEnvelope(payload).canvas;
}

function cacheKeysMatch(
  left: CanvasShareCacheKey,
  right: CanvasShareCacheKey
): boolean {
  return (
    left.mode === right.mode &&
    left.title === right.title &&
    left.content === right.content &&
    left.url === right.url
  );
}

function retainedCharacters(key: CanvasShareCacheKey): number {
  return (
    key.mode.length +
    (key.title?.length ?? 0) +
    (key.content?.length ?? 0) +
    (key.url?.length ?? 0) +
    1
  );
}

function isReusable(result: CanvasShareLinkResult, nowMs: number): boolean {
  if (result.kind === "self-contained") return true;
  const expiresAtMs = Date.parse(result.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

function abortIfPending(entry: CanvasShareCacheEntry): void {
  if (entry.phase === "pending") entry.controller.abort();
}

function removeEntry(entry: CanvasShareCacheEntry): void {
  const index = entries.indexOf(entry);
  if (index < 0) return;
  entries.splice(index, 1);
}

function totalRetainedCharacters(): number {
  return entries.reduce((total, entry) => total + entry.retainedCharacters, 0);
}

function enforceBounds(): void {
  while (
    entries.length > MAX_CACHE_ENTRIES ||
    (entries.length > 1 && totalRetainedCharacters() > MAX_RETAINED_CHARACTERS)
  ) {
    const oldest = entries.shift();
    if (oldest) abortIfPending(oldest);
  }
}

function touch(entry: CanvasShareCacheEntry): void {
  const index = entries.indexOf(entry);
  if (index < 0) return;
  entries.splice(index, 1);
  entries.push(entry);
}

export function getOrCreateCanvasShareLink(
  payload: CanvasInlinePayload,
  nowMs: number = Date.now()
): CanvasShareCacheLookup {
  let key: CanvasShareCacheKey;
  try {
    key = cacheKeyFor(payload);
  } catch (error) {
    return { phase: "pending", promise: Promise.reject(error) };
  }
  const existingIndex = entries.findIndex((entry) =>
    cacheKeysMatch(entry.key, key)
  );
  if (existingIndex >= 0) {
    const existing = entries[existingIndex];
    if (existing.phase === "pending") {
      touch(existing);
      return { phase: "pending", promise: existing.promise };
    }
    if (isReusable(existing.result, nowMs)) {
      touch(existing);
      return { phase: "ready", result: existing.result };
    }
    removeEntry(existing);
  }

  const controller = new AbortController();
  const token = Symbol("canvas-share-cache-entry");
  const keyCharacters = retainedCharacters(key);
  const promise = buildCanvasShareLink(
    payload,
    undefined,
    controller.signal
  ).then(
    (result) => {
      const index = entries.findIndex((entry) => entry.token === token);
      if (index >= 0) {
        entries[index] = {
          phase: "ready",
          token,
          key,
          retainedCharacters: keyCharacters,
          result,
        };
      }
      return result;
    },
    (error: unknown) => {
      const entry = entries.find((candidate) => candidate.token === token);
      if (entry) removeEntry(entry);
      throw error;
    }
  );
  const pendingEntry: PendingCanvasShareCacheEntry = {
    phase: "pending",
    token,
    key,
    retainedCharacters: keyCharacters,
    promise,
    controller,
  };
  entries.push(pendingEntry);
  enforceBounds();
  return { phase: "pending", promise };
}

export const canvasShareCacheTestApi = {
  limits: {
    entries: MAX_CACHE_ENTRIES,
    retainedCharacters: MAX_RETAINED_CHARACTERS,
  },
  reset(): void {
    for (const entry of entries) abortIfPending(entry);
    entries.length = 0;
  },
  snapshot(): { size: number; retainedCharacters: number } {
    return {
      size: entries.length,
      retainedCharacters: totalRetainedCharacters(),
    };
  },
};
