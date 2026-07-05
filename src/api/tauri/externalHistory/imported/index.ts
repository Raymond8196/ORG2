import type { ActivityChunk } from "@src/types/session/session";

import type { DispatchCategory } from "../../session";
import { cursorIdeInitialWindow, cursorIdeListSessions } from "../cursorIde";
import type { CursorIdeSessionPage } from "../cursorIde";
import type { ExternalCliSourceProbe } from "../detection";
import {
  claudeCodeHistoryChunks,
  claudeCodeHistoryListSessions,
} from "../sources/claudeCode";
import type {
  ClaudeCodeHistorySessionPage,
  ClaudeCodeHistorySessionRow,
} from "../sources/claudeCode";
import { codexAppChunks, codexAppListSessions } from "../sources/codexApp";
import type {
  CodexAppSessionPage,
  CodexAppSessionRow,
} from "../sources/codexApp";
import {
  opencodeHistoryChunks,
  opencodeHistoryListSessions,
} from "../sources/opencode";
import type {
  OpenCodeHistorySessionPage,
  OpenCodeHistorySessionRow,
} from "../sources/opencode";
import {
  windsurfHistoryChunks,
  windsurfHistoryListSessions,
} from "../sources/windsurf";
import type {
  WindsurfHistorySessionPage,
  WindsurfHistorySessionRow,
} from "../sources/windsurf";
import {
  workBuddyHistoryChunks,
  workBuddyHistoryListSessions,
} from "../sources/workbuddy";
import type {
  WorkBuddyHistorySessionPage,
  WorkBuddyHistorySessionRow,
} from "../sources/workbuddy";
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

export interface ImportedHistorySessionRow {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  category: "external_history";
  readOnly: true;
  model?: string;
  totalTokens: number;
  background: boolean;
  isActive: boolean;
  repoPath?: string;
  storagePath?: string;
  repoName?: string;
  branch?: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  touchedFiles: string[];
}

export interface ImportedHistorySessionPage {
  sessions: ImportedHistorySessionRow[];
  hasMore: boolean;
}

export interface ImportedHistorySource extends ImportedHistorySourceDescriptor {
  dispatchCategory: Extract<DispatchCategory, "external_history">;
  listSessions(args?: {
    limit?: number;
    offset?: number;
  }): Promise<ImportedHistorySessionPage>;
  loadChunks(sessionId: string): Promise<ActivityChunk[]>;
}

function asImportedPage(
  page:
    | CursorIdeSessionPage
    | CodexAppSessionPage
    | ClaudeCodeHistorySessionPage
    | OpenCodeHistorySessionPage
    | WindsurfHistorySessionPage
    | WorkBuddyHistorySessionPage
): ImportedHistorySessionPage {
  return page;
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
    async listSessions(args) {
      return asImportedPage(await cursorIdeListSessions(args));
    },
    async loadChunks(sessionId) {
      return (
        await cursorIdeInitialWindow({
          sessionId,
          recentLimit: CURSOR_IDE_INITIAL_RECENT_BUBBLE_LIMIT,
        })
      ).chunks;
    },
  },
  {
    ...descriptorFor("codex_app"),
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(await codexAppListSessions(args));
    },
    loadChunks: codexAppChunks,
  },
  {
    ...descriptorFor("claude_code"),
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(await claudeCodeHistoryListSessions(args));
    },
    loadChunks: claudeCodeHistoryChunks,
  },
  {
    ...descriptorFor("opencode"),
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(await opencodeHistoryListSessions(args));
    },
    loadChunks: opencodeHistoryChunks,
  },
  {
    ...descriptorFor("windsurf"),
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(await windsurfHistoryListSessions(args));
    },
    loadChunks: windsurfHistoryChunks,
  },
  {
    ...descriptorFor("workbuddy"),
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(await workBuddyHistoryListSessions(args));
    },
    loadChunks: workBuddyHistoryChunks,
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

export type {
  CodexAppSessionRow,
  ClaudeCodeHistorySessionRow,
  OpenCodeHistorySessionRow,
  WindsurfHistorySessionRow,
  WorkBuddyHistorySessionRow,
};
