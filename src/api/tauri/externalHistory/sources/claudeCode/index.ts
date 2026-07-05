import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface ClaudeCodeRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function claudeCodeRecentPaths(args?: {
  limit?: number;
}): Promise<ClaudeCodeRecentPath[]> {
  return invoke<ClaudeCodeRecentPath[]>("claude_code_recent_paths", {
    limit: args?.limit,
  });
}

export async function claudeCodeHistoryChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("claude_code_history_chunks", { sessionId });
}
