/**
 * useDataSourceAutoScan
 *
 * App-wide scheduler that keeps external-history sources fresh. Mounted once in
 * AppBootstrap so it runs regardless of whether the Data Sources panel is open.
 *
 * Every tick it checks each enabled importable source: if its effective cadence
 * (per-source override, else the global frequency) has elapsed since the last
 * scan, it triggers `loadSidebarSessions({ forceRefresh: true })` — the same
 * refresh the manual Rescan uses, so the sidebar/kanban actually re-render — and
 * stamps `lastScannedAt` on the due sources. The underlying reader delta-syncs
 * by file mtime, so a refresh only re-reads sessions that actually changed.
 * Sources set to "manual" are never auto-scanned.
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
import { loadSidebarSessions } from "./sessionAtom/loaders";

// Base cadence of the scheduler's own tick. The shortest source cadence is 60s,
// so a 30s tick keeps drift small without frequent wakeups.
const TICK_MS = 30_000;

export function useDataSourceAutoScan(): void {
  useEffect(() => {
    let running = false;

    const tick = async () => {
      if (running) return;
      const store = getInstrumentedStore();
      const cfgMap = store.get(dataSourceConfigAtom);
      const global = store.get(dataSourceGlobalFrequencyAtom);
      const now = Date.now();

      // Collect the enabled sources whose cadence has elapsed.
      const dueSourceIds: string[] = [];
      for (const { sourceId } of IMPORTED_HISTORY_SOURCE_DESCRIPTORS) {
        const cfg = getSourceConfig(cfgMap, sourceId);
        if (!cfg.enabled) continue;
        const interval = FREQUENCY_INTERVAL_MS[effectiveFrequency(cfg, global)];
        if (interval == null) continue; // manual
        const due =
          cfg.lastScannedAt == null || now - cfg.lastScannedAt >= interval;
        if (due) dueSourceIds.push(sourceId);
      }
      if (dueSourceIds.length === 0) return;

      running = true;
      try {
        // One refresh covers every enabled source (delta-synced, so cheap) and,
        // unlike a per-source cache poke, re-renders the sidebar/kanban.
        await loadSidebarSessions({ forceRefresh: true });
        const scannedAt = Date.now();
        store.set(dataSourceConfigAtom, (prev) => {
          const next = { ...prev };
          for (const sourceId of dueSourceIds) {
            next[sourceId] = {
              ...getSourceConfig(prev, sourceId),
              lastScannedAt: scannedAt,
            };
          }
          return next;
        });
      } catch {
        /* transient; next tick retries */
      } finally {
        running = false;
      }
    };

    const id = window.setInterval(() => void tick(), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
}
