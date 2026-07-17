/**
 * useDataSourceAutoScan
 *
 * App-wide scheduler that keeps external-history sources fresh. Mounted once in
 * AppBootstrap so it runs regardless of whether the Data Sources panel is open.
 *
 * On app startup it immediately scans each enabled, non-manual importable source
 * with an on-disk history store once, regardless of the persisted last-scan
 * timestamp. Sources without a store receive only a cheap presence probe every
 * 30 minutes; when a store appears, its importer runs immediately. Subsequent
 * full scans use the effective per-source/global cadence. Each successful full
 * scan is followed by one unified sidebar cache reload. Sources set to "manual"
 * are never auto-scanned or presence-probed, including at startup.
 *
 * Config is read straight from the shared store on each tick, so the interval is
 * armed once and always sees the latest values without re-arming.
 */
import { useEffect } from "react";

import {
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  externalCliSourceProbe,
  externalHistoryRescanSources,
} from "@src/api/tauri/externalHistory";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import {
  isWindowFocused,
  onWindowFocusRegained,
} from "@src/util/core/windowFocus";

import {
  FREQUENCY_INTERVAL_MS,
  dataSourceConfigAtom,
  dataSourceGlobalFrequencyAtom,
  dataSourcePresenceAtom,
  effectiveFrequency,
  externalSessionsEnabledAtom,
  getSourceConfig,
} from "./dataSourceConfigAtom";
import { loadSidebarSessions } from "./sessionAtom/loaders";

// Base cadence of the scheduler's own tick. The shortest source cadence is 60s,
// so a 30s tick keeps drift small without frequent wakeups.
const TICK_MS = 30_000;

// While the window is unfocused, every source's effective cadence is stretched
// to at least this floor (mirrors the backend git poller's focus-adaptive
// polling): rescans + the sidebar reload they trigger are wasted while nobody
// is looking. Regaining focus runs a pass immediately, so anything that came
// due in the background catches up right away.
const UNFOCUSED_SCAN_INTERVAL_MS = 10 * 60_000;

/** Cadence for refreshing the lightweight store-presence snapshot. */
const SOURCE_PRESENCE_PROBE_INTERVAL_MS = 30 * 60_000;

let autoScanInFlight: Promise<void> | null = null;

async function performDataSourceAutoScan(force: boolean): Promise<void> {
  const store = getInstrumentedStore();
  // Master switch: external sessions fully off — no scans, including startup.
  if (!store.get(externalSessionsEnabledAtom)) return;
  const cfgMap = store.get(dataSourceConfigAtom);
  const previousPresence = store.get(dataSourcePresenceAtom);
  const global = store.get(dataSourceGlobalFrequencyAtom);
  const now = Date.now();

  const focused = isWindowFocused();
  const candidates = IMPORTED_HISTORY_SOURCE_DESCRIPTORS.flatMap(
    ({ sourceId }) => {
      const cfg = getSourceConfig(cfgMap, sourceId);
      if (!cfg.enabled) return [];
      const interval = FREQUENCY_INTERVAL_MS[effectiveFrequency(cfg, global)];
      if (interval == null) return [];
      const effectiveInterval = focused
        ? interval
        : Math.max(interval, UNFOCUSED_SCAN_INTERVAL_MS);
      const due =
        force ||
        cfg.lastScannedAt == null ||
        now - cfg.lastScannedAt >= effectiveInterval;
      return [{ sourceId, scanDue: due }];
    }
  );
  if (candidates.length === 0) return;

  // Presence is checked independently from the full-import cadence. Confirmed
  // absent stores are held to a 30-minute probe; present stores are re-probed
  // on that same cadence so an uninstall/removal eventually stops full scans.
  const probeSourceIds = candidates.flatMap(({ sourceId }) => {
    const presence = previousPresence[sourceId];
    const probeDue =
      force ||
      presence == null ||
      now - presence.checkedAt >= SOURCE_PRESENCE_PROBE_INTERVAL_MS;
    return probeDue ? [sourceId] : [];
  });
  const probeResults = await Promise.allSettled(
    probeSourceIds.map(async (sourceId) => ({
      sourceId,
      probe: await externalCliSourceProbe(sourceId),
    }))
  );
  const successfulProbes = new Map<string, boolean>();
  for (const result of probeResults) {
    if (result.status === "fulfilled" && result.value.probe) {
      successfulProbes.set(
        result.value.sourceId,
        result.value.probe.historyFound
      );
    }
  }
  if (successfulProbes.size > 0) {
    store.set(dataSourcePresenceAtom, (previous) => {
      const next = { ...previous };
      for (const [sourceId, historyFound] of successfulProbes) {
        next[sourceId] = { historyFound, checkedAt: now };
      }
      return next;
    });
  }

  const currentPresence = store.get(dataSourcePresenceAtom);
  const dueSourceIds = candidates.flatMap(({ sourceId, scanDue }) => {
    const before = previousPresence[sourceId];
    const presence = currentPresence[sourceId];
    const newlyAvailable =
      before?.historyFound === false && presence?.historyFound === true;
    // Unknown presence is deliberately allowed through: a failed detector
    // must degrade to the previous full-scan behavior, not hide user history.
    const canScan = presence?.historyFound !== false;
    return canScan && (scanDue || newlyAvailable) ? [sourceId] : [];
  });

  // A successful negative probe is still a completed scheduler check and is
  // surfaced as "Last scan" in the Runtime pane, even though no importer ran.
  const absentProbeIds = [...successfulProbes].flatMap(
    ([sourceId, historyFound]) => (historyFound ? [] : [sourceId])
  );
  if (absentProbeIds.length > 0) {
    store.set(dataSourceConfigAtom, (previous) => {
      const next = { ...previous };
      for (const sourceId of absentProbeIds) {
        next[sourceId] = {
          ...getSourceConfig(previous, sourceId),
          lastScannedAt: now,
        };
      }
      return next;
    });
  }

  if (dueSourceIds.length === 0) return;
  await externalHistoryRescanSources(dueSourceIds);
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
}

/** Run one deduplicated auto-scan pass. `force` is reserved for app startup. */
export async function runDataSourceAutoScan(force = false): Promise<void> {
  if (autoScanInFlight) return autoScanInFlight;

  const pass = performDataSourceAutoScan(force);
  autoScanInFlight = pass;
  try {
    await pass;
  } finally {
    if (autoScanInFlight === pass) autoScanInFlight = null;
  }
}

export function useDataSourceAutoScan(): void {
  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const scan = async (force = false) => {
      try {
        await runDataSourceAutoScan(force);
      } catch {
        /* transient; next tick retries */
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => void scan(), TICK_MS);
        }
      }
    };

    void scan(true);
    // Catch-up pass the moment focus returns: the tick itself keeps running
    // while unfocused (cheap due-check), but sources are held to the 10-minute
    // background floor — this runs anything that came due at its normal
    // cadence immediately. Runs outside the timer chain so it never re-arms
    // a second timeout loop; runDataSourceAutoScan dedupes concurrent passes.
    const unsubscribeFocus = onWindowFocusRegained(() => {
      if (!cancelled) void runDataSourceAutoScan(false);
    });
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      unsubscribeFocus();
    };
  }, []);
}
