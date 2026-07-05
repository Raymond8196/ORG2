import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface WorkBuddyRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function workBuddyRecentPaths(args?: {
  limit?: number;
}): Promise<WorkBuddyRecentPath[]> {
  return invoke<WorkBuddyRecentPath[]>("workbuddy_recent_paths", {
    limit: args?.limit,
  });
}

export async function workBuddyHistoryChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("workbuddy_history_chunks", { sessionId });
}
