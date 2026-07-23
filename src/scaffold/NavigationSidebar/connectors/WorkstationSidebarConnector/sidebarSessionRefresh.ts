import { useEffect } from "react";

import {
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  externalHistoryRescanSources,
} from "@src/api/tauri/externalHistory";
import { loadSidebarSessions } from "@src/store/session";
import {
  dataSourceConfigAtom,
  externalSessionsEnabledAtom,
  getSourceConfig,
} from "@src/store/session/dataSourceConfigAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

/** Rescan every enabled external source, then reload the sidebar from cache. */
export async function rescanSidebarSessions(): Promise<void> {
  const store = getInstrumentedStore();
  if (!store.get(externalSessionsEnabledAtom)) {
    // External sessions are switched off entirely — nothing to rescan, and
    // the sidebar reload below would be a no-op for external categories.
    await loadSidebarSessions({ forceRefresh: true });
    return;
  }
  const config = store.get(dataSourceConfigAtom);
  const sourceIds = IMPORTED_HISTORY_SOURCE_DESCRIPTORS.filter(
    ({ sourceId }) => getSourceConfig(config, sourceId).enabled
  ).map(({ sourceId }) => sourceId);

  const scanResult = await externalHistoryRescanSources(sourceIds);
  if (scanResult?.changedSources.length !== 0) {
    await loadSidebarSessions({ forceRefresh: true });
  }

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
