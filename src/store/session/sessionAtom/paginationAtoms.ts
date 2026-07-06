/**
 * Per-category pagination state for the sidebar's session list.
 *
 * The sidebar fetches each list bucket in its own page (top N per category, see
 * `SESSION_SIDEBAR_PAGE_SIZE`) so a power user with 5000 CLI sessions doesn't
 * make us pull all of them just to render the "Today" bucket. Imported history
 * sources get their own source-specific pagination keys so Codex App and future
 * Claude Code pages cannot overwrite each other.
 */
import { atom } from "jotai";

import {
  IMPORTED_HISTORY_SOURCES,
  type ImportedHistoryListCategory,
} from "@src/api/tauri/externalHistory";

export type BaseSessionListCategory = "cli_agent" | "rust_agent";

export type SessionListCategory =
  | BaseSessionListCategory
  | ImportedHistoryListCategory;

export const BASE_SESSION_LIST_CATEGORIES: readonly BaseSessionListCategory[] =
  ["cli_agent", "rust_agent"];

export const SESSION_LIST_CATEGORIES: readonly SessionListCategory[] = [
  ...BASE_SESSION_LIST_CATEGORIES,
  ...IMPORTED_HISTORY_SOURCES.map((source) => source.listCategory),
];

/**
 * Default page size per category. 10 rows is enough to cover the most-recent
 * "Today" / "Yesterday" buckets for an average user; the "Load more" row
 * fetches another page on demand.
 */
export const SESSION_SIDEBAR_PAGE_SIZE = 10;

export interface CategoryPaginationState {
  loaded: number;
  hasMore: boolean;
  loading: boolean;
}

const DEFAULT_STATE: CategoryPaginationState = {
  loaded: 0,
  hasMore: false,
  loading: false,
};

export type SessionPaginationMap = Readonly<
  Record<SessionListCategory, CategoryPaginationState>
>;

function makeInitialMap(): SessionPaginationMap {
  const entries = SESSION_LIST_CATEGORIES.map(
    (category) => [category, { ...DEFAULT_STATE }] as const
  );
  return Object.fromEntries(entries) as SessionPaginationMap;
}

export const sessionPaginationAtom =
  atom<SessionPaginationMap>(makeInitialMap());
sessionPaginationAtom.debugLabel = "sessionPaginationAtom";

export function resetPaginationState(): SessionPaginationMap {
  return makeInitialMap();
}
