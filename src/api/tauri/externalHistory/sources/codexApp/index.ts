import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface CodexAppRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function codexAppRecentPaths(args?: {
  limit?: number;
}): Promise<CodexAppRecentPath[]> {
  return invoke<CodexAppRecentPath[]>("codex_app_recent_paths", {
    limit: args?.limit,
  });
}

export async function codexAppChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("codex_app_chunks", { sessionId });
}
