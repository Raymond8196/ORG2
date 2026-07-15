import { useCallback, useEffect, useRef, useState } from "react";

import {
  type OrgtrackFileSessionHistory,
  getOrgtrackFileSessionHistory,
} from "@src/api/tauri/lineage";

export interface UseOrgtrackFileSessionHistoryOptions {
  repoPath: string;
  filePath: string | null;
  autoLoad?: boolean;
}

export interface UseOrgtrackFileSessionHistoryResult {
  history: OrgtrackFileSessionHistory | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOrgtrackFileSessionHistory({
  repoPath,
  filePath,
  autoLoad = true,
}: UseOrgtrackFileSessionHistoryOptions): UseOrgtrackFileSessionHistoryResult {
  const [history, setHistory] = useState<OrgtrackFileSessionHistory | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!filePath || !repoPath) {
      setHistory(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextHistory = await getOrgtrackFileSessionHistory({
        repoPath,
        filePath,
      });
      if (requestId === requestIdRef.current) {
        setHistory(nextHistory);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
        setHistory(null);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [filePath, repoPath]);

  useEffect(() => {
    if (autoLoad) {
      void refresh();
    }
  }, [autoLoad, refresh]);

  useEffect(() => {
    if (
      !autoLoad ||
      !history ||
      !["queued", "discovering", "indexing"].includes(history.backfill.status)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [autoLoad, history, refresh]);

  return { history, loading, error, refresh };
}
