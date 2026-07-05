/**
 * Cursor IDE history — Tauri API wrappers.
 *
 * These commands surface Cursor IDE chat history (read from Cursor's
 * `~/.../state.vscdb`) as read-only sessions in our session list.
 * Frontend never sees the bare composer UUID — every session id is
 * prefixed with `cursoride-` (see `CURSOR_IDE_SESSION_PREFIX`).
 */
import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface CursorIdeTurnSummary {
  turnId: string;
  nextTurnId: string | null;
  turnIndex: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  userPreview: string;
  eventCount: number;
  bodyEventCount: number;
}

export interface CursorIdeInitialWindow {
  chunks: ActivityChunk[];
  turns: CursorIdeTurnSummary[];
  totalBubbleCount: number;
  userBubbleCount: number;
  recentBubbleCount: number;
  recentStartCursor: string | null;
  recentEndCursor: string | null;
  hasUnloadedMiddle: boolean;
}

export interface CursorIdeFullRefresh {
  chunks: ActivityChunk[];
  turns: CursorIdeTurnSummary[];
}

export interface CursorIdeTurnWindow {
  chunks: ActivityChunk[];
  userBubbleId: string;
  nextUserBubbleId: string | null;
  loadedBubbleCount: number;
}

/**
 * Read all bubbles for one Cursor IDE composer, returned as `ActivityChunk[]`
 * ready to feed through the standard event pipeline (`processChunksRust` →
 * `eventStoreProxy` → `ChatHistory`).
 */
export async function cursorIdeChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("cursor_ide_chunks", { sessionId });
}

export async function cursorIdeInitialWindow(args: {
  sessionId: string;
  recentLimit?: number;
}): Promise<CursorIdeInitialWindow> {
  return invoke<CursorIdeInitialWindow>("cursor_ide_initial_window", {
    sessionId: args.sessionId,
    recentLimit: args.recentLimit,
  });
}

export async function cursorIdeFullRefresh(
  sessionId: string
): Promise<CursorIdeFullRefresh> {
  return invoke<CursorIdeFullRefresh>("cursor_ide_full_refresh", { sessionId });
}

export async function cursorIdeTurnWindow(args: {
  sessionId: string;
  userBubbleId: string;
}): Promise<CursorIdeTurnWindow> {
  return invoke<CursorIdeTurnWindow>("cursor_ide_turn_window", {
    sessionId: args.sessionId,
    userBubbleId: args.userBubbleId,
  });
}

/**
 * Hover-card detail for a single Cursor IDE session.
 *
 * Fetches `repo_path`, `repo_name`, `branch`, and `touched_files` on demand —
 * these fields are NOT included in the list response to keep pagination fast.
 * Call only when the hover card actually opens.
 */
export interface CursorIdeSessionDetail {
  repoPath?: string;
  storagePath?: string;
  repoName?: string;
  branch?: string;
  touchedFiles: string[];
}

export async function cursorIdeSessionDetail(
  sessionId: string
): Promise<CursorIdeSessionDetail> {
  return invoke<CursorIdeSessionDetail>("cursor_ide_session_detail", {
    sessionId,
  });
}
