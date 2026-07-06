import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface OpenCodeRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function opencodeRecentPaths(args?: {
  limit?: number;
}): Promise<OpenCodeRecentPath[]> {
  return invoke<OpenCodeRecentPath[]>("opencode_recent_paths", {
    limit: args?.limit,
  });
}

export async function opencodeHistoryChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("opencode_history_chunks", { sessionId });
}
