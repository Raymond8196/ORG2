import type { ActivityChunk } from "@src/types/session/session";

import type { DispatchCategory } from "../../session";
import { cursorIdeChunks, cursorIdeInitialWindow } from "../cursorIde";
import type { ExternalCliSourceProbe } from "../detection";
import { claudeCodeHistoryChunks } from "../sources/claudeCode";
import { clineHistoryChunks } from "../sources/cline";
import { codexAppChunks } from "../sources/codexApp";
import { opencodeHistoryChunks } from "../sources/opencode";
import { traeHistoryChunks } from "../sources/trae";
import { warpHistoryChunks } from "../sources/warp";
import { windsurfHistoryChunks } from "../sources/windsurf";
import { workBuddyHistoryChunks } from "../sources/workbuddy";
import { zcodeHistoryChunks } from "../sources/zcode";
import {
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  type ImportedHistoryListCategory,
  type ImportedHistorySourceDescriptor,
  type ImportedHistorySourceId,
} from "./descriptors";

export type {
  ImportedHistoryListCategory,
  ImportedHistorySourceDescriptor,
  ImportedHistorySourceId,
};
export { IMPORTED_HISTORY_SOURCE_DESCRIPTORS };

export interface ImportedHistorySource extends ImportedHistorySourceDescriptor {
  dispatchCategory: Extract<DispatchCategory, "external_history">;
  /** Fast/windowed transcript used when the user opens the local history. */
  loadPreviewChunks(sessionId: string): Promise<ActivityChunk[]>;
  /** Complete source transcript used for cloud replay/fork publication. */
  loadFullTranscriptChunks(sessionId: string): Promise<ActivityChunk[]>;
}

const CURSOR_IDE_INITIAL_RECENT_BUBBLE_LIMIT = 100;

function descriptorFor(
  sourceId: ImportedHistorySourceId
): ImportedHistorySourceDescriptor {
  const descriptor = IMPORTED_HISTORY_SOURCE_DESCRIPTORS.find(
    (entry) => entry.sourceId === sourceId
  );
  if (!descriptor) {
    throw new Error(`Missing imported history source descriptor: ${sourceId}`);
  }
  return descriptor;
}

export const IMPORTED_HISTORY_SOURCES: readonly ImportedHistorySource[] = [
  {
    ...descriptorFor("cursor_ide"),
    dispatchCategory: "external_history",
    async loadPreviewChunks(sessionId) {
      return (
        await cursorIdeInitialWindow({
          sessionId,
          recentLimit: CURSOR_IDE_INITIAL_RECENT_BUBBLE_LIMIT,
        })
      ).chunks;
    },
    loadFullTranscriptChunks: cursorIdeChunks,
  },
  {
    ...descriptorFor("codex_app"),
    dispatchCategory: "external_history",
    loadPreviewChunks: codexAppChunks,
    loadFullTranscriptChunks: codexAppChunks,
  },
  {
    ...descriptorFor("claude_code"),
    dispatchCategory: "external_history",
    loadPreviewChunks: claudeCodeHistoryChunks,
    loadFullTranscriptChunks: claudeCodeHistoryChunks,
  },
  {
    ...descriptorFor("opencode"),
    dispatchCategory: "external_history",
    loadPreviewChunks: opencodeHistoryChunks,
    loadFullTranscriptChunks: opencodeHistoryChunks,
  },
  {
    ...descriptorFor("windsurf"),
    dispatchCategory: "external_history",
    loadPreviewChunks: windsurfHistoryChunks,
    loadFullTranscriptChunks: windsurfHistoryChunks,
  },
  {
    ...descriptorFor("workbuddy"),
    dispatchCategory: "external_history",
    loadPreviewChunks: workBuddyHistoryChunks,
    loadFullTranscriptChunks: workBuddyHistoryChunks,
  },
  {
    ...descriptorFor("trae"),
    dispatchCategory: "external_history",
    loadPreviewChunks: traeHistoryChunks,
    loadFullTranscriptChunks: traeHistoryChunks,
  },
  {
    ...descriptorFor("cline"),
    dispatchCategory: "external_history",
    loadPreviewChunks: clineHistoryChunks,
    loadFullTranscriptChunks: clineHistoryChunks,
  },
  {
    ...descriptorFor("warp"),
    dispatchCategory: "external_history",
    loadPreviewChunks: warpHistoryChunks,
    loadFullTranscriptChunks: warpHistoryChunks,
  },
  {
    ...descriptorFor("zcode"),
    dispatchCategory: "external_history",
    loadPreviewChunks: zcodeHistoryChunks,
    loadFullTranscriptChunks: zcodeHistoryChunks,
  },
];

export function getImportedHistorySourceBySessionId(
  sessionId: string | null | undefined
): ImportedHistorySource | undefined {
  if (!sessionId) return undefined;
  return IMPORTED_HISTORY_SOURCES.find((source) =>
    sessionId.startsWith(source.prefix)
  );
}

export function getImportedHistorySourceByListCategory(
  category: ImportedHistoryListCategory
): ImportedHistorySource | undefined {
  return IMPORTED_HISTORY_SOURCES.find(
    (source) => source.listCategory === category
  );
}

export function isImportedHistoryListCategory(
  category: string
): category is ImportedHistoryListCategory {
  return IMPORTED_HISTORY_SOURCES.some(
    (source) => source.listCategory === category
  );
}

export function isImportedHistorySourceSession(
  sessionId: string,
  source: ImportedHistorySource
): boolean {
  return sessionId.startsWith(source.prefix);
}

export function isImportedHistoryReplayableSourceId(
  sourceId: string | null | undefined
): sourceId is ImportedHistorySourceId {
  if (!sourceId) return false;
  return IMPORTED_HISTORY_SOURCES.some(
    (source) => source.sourceId === sourceId
  );
}

export function getDetectedExternalCliSourcesWithoutReplay(
  probes: readonly ExternalCliSourceProbe[]
): ExternalCliSourceProbe[] {
  return probes.filter(
    (probe) => !isImportedHistoryReplayableSourceId(probe.sourceId)
  );
}
