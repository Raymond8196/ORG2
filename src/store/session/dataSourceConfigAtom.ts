/**
 * Per-source configuration for external history data sources.
 *
 * Persisted in localStorage (mirrors the `cliAgentVisibilityAtom` pattern).
 * Holds, per importable source id:
 *  - `enabled`  — when false, the source's sessions are NOT loaded anywhere
 *                 (gated in `loadSidebarSessions`).
 *  - `frequency`— how often the Data Sources panel auto-rescans the source.
 *  - `lastScannedAt` — epoch ms of the last successful (re)scan; machine-written.
 *
 * Missing entries fall back to {@link DEFAULT_DATA_SOURCE_CONFIG}.
 */
import { atomWithStorage } from "jotai/utils";

export type ScanFrequency = "manual" | "5m" | "1h" | "1d";

export interface DataSourceConfig {
  enabled: boolean;
  frequency: ScanFrequency;
  lastScannedAt: number | null;
}

export const DEFAULT_DATA_SOURCE_CONFIG: DataSourceConfig = {
  enabled: true,
  frequency: "manual",
  lastScannedAt: null,
};

export type DataSourceConfigMap = Record<string, DataSourceConfig>;

const STORAGE_KEY = "orgii:dataSourceConfig";

export const dataSourceConfigAtom = atomWithStorage<DataSourceConfigMap>(
  STORAGE_KEY,
  {}
);

/** Resolve a source's config, applying defaults for any missing fields. */
export function getSourceConfig(
  map: DataSourceConfigMap,
  sourceId: string
): DataSourceConfig {
  return { ...DEFAULT_DATA_SOURCE_CONFIG, ...(map[sourceId] ?? {}) };
}

/** True only when the source has been explicitly disabled. */
export function isSourceDisabled(
  map: DataSourceConfigMap,
  sourceId: string
): boolean {
  return map[sourceId]?.enabled === false;
}

/** Auto-rescan interval per frequency, in ms. `null` = manual (never auto). */
export const FREQUENCY_INTERVAL_MS: Record<ScanFrequency, number | null> = {
  manual: null,
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export const SCAN_FREQUENCIES: readonly ScanFrequency[] = [
  "manual",
  "5m",
  "1h",
  "1d",
];
