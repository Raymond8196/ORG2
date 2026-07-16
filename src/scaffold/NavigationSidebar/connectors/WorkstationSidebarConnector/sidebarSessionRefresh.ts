import { useEffect } from "react";

import {
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  externalHistoryRescanSources,
} from "@src/api/tauri/externalHistory";
import { loadSidebarSessions } from "@src/store/session";
import {
  dataSourceConfigAtom,
  getSourceConfig,
} from "@src/store/session/dataSourceConfigAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

/** Rescan every enabled external source, then reload the sidebar from cache. */
export async function rescanSidebarSessions(): Promise<void> {
  const store = getInstrumentedStore();
  const config = store.get(dataSourceConfigAtom);
  const sourceIds = IMPORTED_HISTORY_SOURCE_DESCRIPTORS.filter(
    ({ sourceId }) => getSourceConfig(config, sourceId).enabled
  ).map(({ sourceId }) => sourceId);

  await externalHistoryRescanSources(sourceIds);
  await loadSidebarSessions({ forceRefresh: true });

  const lastScannedAt = Date.now();
  store.set(dataSourceConfigAtom, (previous) => {
    const next = { ...previous };
    for (const sourceId of sourceIds) {
      next[sourceId] = {
        ...getSourceConfig(previous, sourceId),
        lastScannedAt,
      };
    }
    return next;
  });
}

export function useSidebarSessionRefreshEffects(): void {
  useEffect(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);
}
