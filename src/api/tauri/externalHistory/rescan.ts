import { invoke } from "@tauri-apps/api/core";

import type { ImportedHistorySourceId } from "./imported/descriptors";

/**
 * Rescan a single external history source, re-reading its on-disk store and
 * repopulating the metadata cache.
 *
 * - `clear: false` (default) — **update**: incrementally re-sync, re-parsing
 *   only sessions whose on-disk signature changed (e.g. after a parser-version
 *   bump). Fast and non-destructive.
 * - `clear: true` — **clear + rescan**: wipe the source's cached rows first,
 *   then re-parse everything from scratch. Use to drop stale rows or force a
 *   full rebuild.
 *
 * Both modes leave the cache populated, so callers can immediately re-read the
 * count / sidebar without a separate lazy load.
 */
export async function externalHistoryRescanSource(
  source: ImportedHistorySourceId,
  options?: { clear?: boolean }
): Promise<void> {
  await invoke("external_history_rescan_source", {
    source,
    clear: options?.clear ?? false,
  });
}
