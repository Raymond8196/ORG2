/**
 * useDataSourceAutoScan
 *
 * App-wide scheduler that keeps external-history sources fresh. Mounted once in
 * AppBootstrap so it runs regardless of whether the Data Sources panel is open.
 *
 * Every tick it checks each enabled importable source: if its effective cadence
 * (per-source override, else the global frequency) has elapsed since the last
 * scan, it triggers an incremental `refreshImportedHistorySource` (delta-sync —
 * only changed sessions are re-read) and stamps `lastScannedAt`. Sources set to
 * "manual" are never auto-scanned.
 *
 * Config is read straight from the shared store on each tick, so the interval is
 * armed once and always sees the latest values without re-arming.
 */
import { useEffect } from "react";

import { IMPORTED_HISTORY_SOURCE_DESCRIPTORS } from "@src/api/tauri/externalHistory";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  FREQUENCY_INTERVAL_MS,
  dataSourceConfigAtom,
  dataSourceGlobalFrequencyAtom,
  effectiveFrequency,
  getSourceConfig,
} from "./dataSourceConfigAtom";
import { refreshImportedHistorySource } from "./sessionAtom/loaders";

// Base cadence of the scheduler's own tick. The shortest source cadence is 60s,
// so a 30s tick keeps drift small without frequent wakeups.
const TICK_MS = 30_000;

export function useDataSourceAutoScan(): void {
  useEffect(() => {
    const inFlight = new Set<string>();

    const tick = () => {
      const store = getInstrumentedStore();
      const cfgMap = store.get(dataSourceConfigAtom);
      const global = store.get(dataSourceGlobalFrequencyAtom);
      const now = Date.now();

      for (const { sourceId } of IMPORTED_HISTORY_SOURCE_DESCRIPTORS) {
        if (inFlight.has(sourceId)) continue;
        const cfg = getSourceConfig(cfgMap, sourceId);
        if (!cfg.enabled) continue;
        const interval = FREQUENCY_INTERVAL_MS[effectiveFrequency(cfg, global)];
        if (interval == null) continue; // manual
        const due =
          cfg.lastScannedAt == null || now - cfg.lastScannedAt >= interval;
        if (!due) continue;

        inFlight.add(sourceId);
        void refreshImportedHistorySource(sourceId)
          .catch(() => {
            /* transient; next tick retries */
          })
          .finally(() => {
            inFlight.delete(sourceId);
            store.set(dataSourceConfigAtom, (prev) => ({
              ...prev,
              [sourceId]: {
                ...getSourceConfig(prev, sourceId),
                lastScannedAt: Date.now(),
              },
            }));
          });
      }
    };

    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, []);
}
