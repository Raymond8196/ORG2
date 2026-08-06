import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface ImportedHistoryCloudTurnWindow {
  turnId: string;
  chunks: ActivityChunk[];
}

export async function importedHistoryCloudTurnIds(
  sessionId: string
): Promise<string[]> {
  return invoke<string[]>("imported_history_cloud_turn_ids", { sessionId });
}

export async function importedHistoryCloudTurnWindows(args: {
  sessionId: string;
  turnIds: string[];
  startSequence: number;
}): Promise<ImportedHistoryCloudTurnWindow[]> {
  return invoke<ImportedHistoryCloudTurnWindow[]>(
    "imported_history_cloud_turn_windows",
    args
  );
}
