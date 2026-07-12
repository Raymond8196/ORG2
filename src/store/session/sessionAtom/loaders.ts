/**
 * Session Loaders
 *
 * Two complementary loading paths:
 *
 *  - `loadSessions()` — legacy "load everything (with limit/offset)" entry
 *    used by panels that want a single flat list across all categories
 *    (Chat history panel, Simulator panel, useSessionManager).
 *
 *  - `loadSidebarSessions()` / `loadMoreCategory()` — sidebar-specific
 *    paginated loaders. Native categories fetch one top-N page; imported
 *    sources fetch lightweight, independent date-bucket pages from ORGII's
 *    cache so a busy Today bucket cannot hide Yesterday.
 */
import {
  type ImportedHistorySource,
  getImportedHistorySourceByListCategory,
  isImportedHistoryListCategory,
  isImportedHistorySourceSession,
} from "@src/api/tauri/externalHistory";
import {
  type ExternalHistorySidebarResponse,
  type SessionFilter,
  type SessionListResponse,
  externalHistorySidebarList,
  sessionAggregateList,
  toFrontendSessions,
} from "@src/api/tauri/session";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import {
  SESSION_DATE_BUCKET_KEYS,
  getSessionDateBucketRanges,
} from "@src/util/session/sessionDateBuckets";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import {
  dataSourceConfigAtom,
  isSourceDisabled,
} from "../dataSourceConfigAtom";
import {
  sessionErrorAtom,
  sessionFlatListLastLoadedBySignatureAtom,
  sessionLastLoadedAtom,
  sessionLoadingAtom,
  sessionsAtom,
} from "./atoms";
import {
  type DateBucketPaginationMap,
  SESSION_LIST_CATEGORIES,
  SESSION_SIDEBAR_PAGE_SIZE,
  type SessionListCategory,
  type SessionPaginationMap,
  emptyDateBucketPagination,
  resetPaginationState,
  sessionPaginationAtom,
} from "./paginationAtoms";
import { persistSessions } from "./persistence";
import type { Session, SessionStatus } from "./types";

const log = createLogger("SessionAtom");

const getStore = () => getInstrumentedStore();
const BULK_CACHE_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_FLAT_LIST_PAGE_SIZE = 200;

interface LoadSessionsOptions {
  repoPath?: string;
  orgId?: string;
  projectSlug?: string;
  workItemId?: string;
  status?: SessionStatus;
  limit?: number;
  offset?: number;
  forceRefresh?: boolean;
}

function loadSessionsCacheSignature(options?: LoadSessionsOptions): string {
  return [
    options?.repoPath ?? "",
    options?.orgId ?? "",
    options?.projectSlug ?? "",
    options?.workItemId ?? "",
    options?.status ?? "",
    options?.limit ?? "",
    options?.offset ?? "",
  ].join("\u001f");
}

function mergeSessions(
  prev: readonly Session[],
  incoming: readonly Session[]
): Session[] {
  if (incoming.length === 0) return prev.slice();
  const incomingMap = new Map(
    incoming.map((session) => [session.session_id, session])
  );
  const merged: Session[] = prev.map(
    (session) => incomingMap.get(session.session_id) ?? session
  );
  const seen = new Set(merged.map((session) => session.session_id));
  for (const session of incoming) {
    if (!seen.has(session.session_id)) {
      merged.push(session);
      seen.add(session.session_id);
    }
  }
  merged.sort((sessionA, sessionB) =>
    (sessionB.updated_at || "").localeCompare(sessionA.updated_at || "")
  );
  return merged;
}

function replaceImportedFirstPage(
  prev: readonly Session[],
  incoming: readonly Session[],
  predicate: (sessionId: string) => boolean
): Session[] {
  const retained = prev.filter((session) => !predicate(session.session_id));
  return mergeSessions(retained, incoming);
}

function replaceExternalHistorySourceFirstPage(
  prev: readonly Session[],
  incoming: readonly Session[],
  source: ImportedHistorySource
): Session[] {
  return replaceImportedFirstPage(prev, incoming, (sessionId) =>
    isImportedHistorySourceSession(sessionId, source)
  );
}

function setPaginationFor(
  category: SessionListCategory,
  patch: Partial<SessionPaginationMap[SessionListCategory]>
) {
  const store = getStore();
  store.set(sessionPaginationAtom, (prev) => ({
    ...prev,
    [category]: { ...prev[category], ...patch },
  }));
}

async function loadImportedHistorySourcePage(
  source: ImportedHistorySource,
  currentBuckets: DateBucketPaginationMap | undefined,
  pageSize: number
): Promise<FetchPageResult> {
  const ranges = getSessionDateBucketRanges();
  const buckets = ranges
    .filter(({ bucket }) => !currentBuckets || currentBuckets[bucket].hasMore)
    .map(({ bucket, startMs, endMs }) => ({
      bucket,
      startMs,
      endMs,
      limit: pageSize,
      offset: currentBuckets?.[bucket].loaded ?? 0,
    }));
  if (buckets.length === 0) {
    return {
      sessions: [],
      hasMore: false,
      dateBuckets: currentBuckets ?? emptyDateBucketPagination(),
    };
  }

  const response = await externalHistorySidebarList({
    source: source.sourceId,
    buckets,
  });
  const dateBuckets = mergeDateBucketPagination(currentBuckets, response);
  const sessions = response.buckets.flatMap((page) =>
    page.sessions.map((row): Session => {
      const name = row.name.trim() || row.sessionId;
      return {
        session_id: row.sessionId,
        name,
        status: "completed",
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        created_time: row.createdAt,
        updated_time: row.updatedAt,
        category: "external_history",
        readOnly: true,
        is_active: false,
        background: false,
        repoPath: row.repoPath,
        agentIconId: source.iconId,
        agentDisplayName: source.displayName,
        model: row.model,
        totalTokens: row.totalTokens,
        filesChanged: row.filesChanged,
        linesAdded: row.linesAdded,
        linesRemoved: row.linesRemoved,
        touchedFiles: row.touchedFiles,
      };
    })
  );
  return {
    sessions,
    hasMore: SESSION_DATE_BUCKET_KEYS.some(
      (bucket) => dateBuckets[bucket].hasMore
    ),
    dateBuckets,
  };
}

function mergeDateBucketPagination(
  current: DateBucketPaginationMap | undefined,
  response: ExternalHistorySidebarResponse
): DateBucketPaginationMap {
  const next = { ...(current ?? emptyDateBucketPagination()) };
  for (const page of response.buckets) {
    const previous = next[page.bucket];
    next[page.bucket] = {
      loaded: previous.loaded + page.sessions.length,
      hasMore: page.hasMore,
    };
  }
  return next;
}

export const loadSessions = async (options?: LoadSessionsOptions) => {
  const store = getStore();
  const { forceRefresh = false } = options || {};
  const cacheSignature = loadSessionsCacheSignature(options);

  const lastLoaded = store.get(sessionFlatListLastLoadedBySignatureAtom)[
    cacheSignature
  ];
  const now = Date.now();

  if (
    !forceRefresh &&
    lastLoaded &&
    now - lastLoaded < BULK_CACHE_DURATION_MS
  ) {
    return;
  }

  store.set(sessionLoadingAtom, true);
  store.set(sessionErrorAtom, null);

  try {
    const filter: SessionFilter | undefined =
      options?.repoPath ||
      options?.orgId ||
      options?.projectSlug ||
      options?.workItemId ||
      options?.status ||
      options?.limit ||
      options?.offset
        ? {
            repoPath: options?.repoPath,
            orgId: options?.orgId,
            projectSlug: options?.projectSlug,
            workItemId: options?.workItemId,
            status: options?.status,
            limit: options?.limit,
            offset: options?.offset,
          }
        : undefined;

    const response = await sessionAggregateList({
      ...filter,
      limit: filter?.limit ?? DEFAULT_FLAT_LIST_PAGE_SIZE,
      includeExternalHistory: true,
      includeStats: false,
      sortBy: filter?.sortBy ?? "updated_at",
      sortOrder: filter?.sortOrder ?? "desc",
    });

    const fetched: Session[] = toFrontendSessions(
      (response as SessionListResponse).sessions
    );

    fetched.sort((sessionA, sessionB) =>
      (sessionB.updated_at || "").localeCompare(sessionA.updated_at || "")
    );

    store.set(sessionsAtom, fetched);
    persistSessions(fetched);
    store.set(sessionFlatListLastLoadedBySignatureAtom, (prev) => ({
      ...prev,
      [cacheSignature]: now,
    }));
  } catch (error) {
    log.error("[SessionAtom] Failed to load sessions:", error);
    store.set(
      sessionErrorAtom,
      error instanceof Error ? error.message : "Failed to load sessions"
    );
  } finally {
    store.set(sessionLoadingAtom, false);
  }
};

interface FetchPageResult {
  sessions: Session[];
  hasMore: boolean;
  dateBuckets?: DateBucketPaginationMap;
}

async function fetchAggregatePage(
  wireCategory: "cli" | "agent",
  offset: number,
  pageSize: number
): Promise<FetchPageResult> {
  const response = await sessionAggregateList({
    category: wireCategory,
    includeExternalHistory: false,
    includeStats: false,
    limit: pageSize + 1,
    offset,
    sortBy: "updated_at",
    sortOrder: "desc",
  });
  const primarySessions = toFrontendSessions(response.sessions)
    .filter(isPrimarySessionListSession)
    .slice(0, pageSize);
  return {
    sessions: primarySessions,
    hasMore: response.sessions.length > pageSize,
  };
}

async function loadCategoryPage(
  category: SessionListCategory,
  offset: number,
  pageSize: number,
  dateBuckets?: DateBucketPaginationMap
): Promise<FetchPageResult> {
  if (isImportedHistoryListCategory(category)) {
    const source = getImportedHistorySourceByListCategory(category);
    if (!source) return { sessions: [], hasMore: false };
    return loadImportedHistorySourcePage(source, dateBuckets, pageSize);
  }

  switch (category) {
    case "cli_agent":
      return fetchAggregatePage("cli", offset, pageSize);
    case "rust_agent":
      return fetchAggregatePage("agent", offset, pageSize);
  }
}

function replaceFirstPageForCategory(
  category: SessionListCategory,
  prev: readonly Session[],
  incoming: readonly Session[]
): Session[] {
  if (isImportedHistoryListCategory(category)) {
    const source = getImportedHistorySourceByListCategory(category);
    return source
      ? replaceExternalHistorySourceFirstPage(prev, incoming, source)
      : mergeSessions(prev, incoming);
  }
  return mergeSessions(prev, incoming);
}

export const loadSidebarSessions = async (options?: {
  pageSize?: number;
  forceRefresh?: boolean;
}) => {
  const store = getStore();
  const pageSize = options?.pageSize ?? SESSION_SIDEBAR_PAGE_SIZE;
  const { forceRefresh = false } = options ?? {};

  const lastLoaded = store.get(sessionLastLoadedAtom);
  const now = Date.now();

  if (
    !forceRefresh &&
    lastLoaded &&
    now - lastLoaded < BULK_CACHE_DURATION_MS
  ) {
    return;
  }

  store.set(sessionLoadingAtom, true);
  store.set(sessionErrorAtom, null);
  store.set(sessionPaginationAtom, resetPaginationState());

  // Sources the user has disabled in the Data Sources panel must not load.
  const dataSourceConfig = store.get(dataSourceConfigAtom);
  const isCategoryDisabled = (category: string): boolean => {
    if (!isImportedHistoryListCategory(category)) return false;
    const source = getImportedHistorySourceByListCategory(category);
    return source ? isSourceDisabled(dataSourceConfig, source.sourceId) : false;
  };

  for (const category of SESSION_LIST_CATEGORIES) {
    setPaginationFor(category, { loading: true });
  }

  await Promise.allSettled(
    SESSION_LIST_CATEGORIES.map(async (category) => {
      // Disabled source: clear any previously-loaded page and skip.
      if (isCategoryDisabled(category)) {
        store.set(sessionsAtom, (prev) =>
          replaceFirstPageForCategory(category, prev, [])
        );
        setPaginationFor(category, {
          loaded: 0,
          hasMore: false,
          loading: false,
        });
        return;
      }
      try {
        const { sessions, hasMore, dateBuckets } = await loadCategoryPage(
          category,
          0,
          pageSize
        );
        store.set(sessionsAtom, (prev) =>
          replaceFirstPageForCategory(category, prev, sessions)
        );
        setPaginationFor(category, {
          loaded: sessions.length,
          hasMore,
          loading: false,
          dateBuckets,
        });
      } catch (error) {
        log.warn(`[SessionAtom] ${category} initial page failed:`, error);
        setPaginationFor(category, { loading: false });
      }
    })
  );

  const merged = store.get(sessionsAtom);
  persistSessions(merged);
  store.set(sessionLastLoadedAtom, now);
  store.set(sessionLoadingAtom, false);
};

export const loadMoreCategory = async (
  category: SessionListCategory,
  pageSize: number = SESSION_SIDEBAR_PAGE_SIZE
) => {
  const store = getStore();
  const current = store.get(sessionPaginationAtom)[category];
  if (current.loading || !current.hasMore) return;

  setPaginationFor(category, { loading: true });

  try {
    const { sessions, hasMore, dateBuckets } = await loadCategoryPage(
      category,
      current.loaded,
      pageSize,
      current.dateBuckets
    );
    const primarySessions = sessions.filter(isPrimarySessionListSession);
    store.set(sessionsAtom, (prev) => mergeSessions(prev, primarySessions));
    setPaginationFor(category, {
      loaded: current.loaded + sessions.length,
      hasMore,
      loading: false,
      dateBuckets,
    });
    persistSessions(store.get(sessionsAtom));
  } catch (error) {
    log.warn(`[SessionAtom] loadMoreCategory(${category}) failed:`, error);
    setPaginationFor(category, { loading: false });
  }
};

export const __TESTS_ONLY = {
  mergeSessions,
  replaceExternalHistorySourceFirstPage,
};
