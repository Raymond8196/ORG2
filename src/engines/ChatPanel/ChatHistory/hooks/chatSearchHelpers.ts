import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export interface RustSearchResult {
  eventId: string;
  chatIndex: number;
  score: number;
  snippet: string;
}

export interface ChatSearchModes {
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

export const DEFAULT_CHAT_SEARCH_MODES: ChatSearchModes = {
  caseSensitive: false,
  useRegex: false,
  wholeWord: false,
};

export interface MappedSearchResult {
  item: SessionEvent;
  index: number;
  score: number;
  snippet: string;
}

function buildEventIdIndex(
  chatHistory: readonly SessionEvent[]
): Map<string, number> {
  const index = new Map<string, number>();
  for (let idx = 0; idx < chatHistory.length; idx++) {
    const event = chatHistory[idx];
    if (event.id) index.set(event.id, idx);
    if (event.chunk_id && event.chunk_id !== event.id) {
      index.set(event.chunk_id, idx);
    }
  }
  return index;
}

function resolveHistoryIndex(
  rustResult: RustSearchResult,
  eventIndex: ReadonlyMap<string, number>,
  chatHistoryLength: number
): number | undefined {
  const byId = eventIndex.get(rustResult.eventId);
  if (byId !== undefined) return byId;
  if (rustResult.chatIndex >= 0 && rustResult.chatIndex < chatHistoryLength) {
    return rustResult.chatIndex;
  }
  return undefined;
}

export function mapRustResultsToSearchResults(
  rustResults: readonly RustSearchResult[],
  chatHistory: readonly SessionEvent[]
): MappedSearchResult[] {
  const eventIndex = buildEventIdIndex(chatHistory);
  const mapped: MappedSearchResult[] = [];

  for (const rustResult of rustResults) {
    const historyIndex = resolveHistoryIndex(
      rustResult,
      eventIndex,
      chatHistory.length
    );
    if (historyIndex === undefined) continue;
    mapped.push({
      item: chatHistory[historyIndex],
      index: historyIndex,
      score: rustResult.score,
      snippet: rustResult.snippet,
    });
  }

  return mapped;
}

export function wrapNextSearchResultIndex(
  currentIndex: number,
  resultCount: number,
  direction: 1 | -1
): number {
  if (resultCount <= 0) return 0;
  if (direction === 1) {
    return (currentIndex + 1) % resultCount;
  }
  return currentIndex === 0 ? resultCount - 1 : currentIndex - 1;
}
