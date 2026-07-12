import { invoke } from "@tauri-apps/api/core";

import type { ImportedHistorySourceId } from "./imported/descriptors";

/**
 * Force a full rescan of a single external history source.
 *
 * Clears the source's cached metadata so the next sidebar/list load re-reads
 * its on-disk store from scratch and repopulates the cache. Callers should
 * follow this with `loadSidebarSessions({ forceRefresh: true })` to trigger the
 * repopulating scan and refresh the UI.
 */
export async function externalHistoryRescanSource(
  source: ImportedHistorySourceId
): Promise<void> {
  await invoke("external_history_rescan_source", { source });
}
