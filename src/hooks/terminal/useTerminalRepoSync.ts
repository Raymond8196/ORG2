/**
 * useTerminalRepoSync
 *
 * Sends `cd <repoPath>` to all initialized terminals when the user
 * switches the active repository.  Only fires on *changes* after
 * the first valid repo path (skips mount & initial load).
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";
import {
  initializedTerminalIdsAtom,
  terminalSessionsAtom,
} from "@src/store/workstation/codeEditor/terminal";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { toBackendPtySessionId } from "@src/util/ui/terminal/ptySessionId";

import { selectRepoSyncTargets } from "./repoSyncTargets";

const log = createLogger("TerminalRepoSync");

function shellEscapePath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function useTerminalRepoSync(): void {
  const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);
  const sessions = useAtomValue(terminalSessionsAtom);
  const initialized = useAtomValue(initializedTerminalIdsAtom);

  const prevRepoPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceRootPath) return;

    const repoPath = activeWorkspaceRootPath.startsWith("file://")
      ? activeWorkspaceRootPath.replace("file://", "")
      : activeWorkspaceRootPath;

    if (prevRepoPathRef.current === null) {
      prevRepoPathRef.current = repoPath;
      return;
    }

    if (repoPath === prevRepoPathRef.current) return;
    prevRepoPathRef.current = repoPath;

    const cdCmd = `cd ${shellEscapePath(repoPath)}\n`;

    for (const session of selectRepoSyncTargets(sessions, initialized)) {
      const ptyId = toBackendPtySessionId(session.id);
      invokeTauri("write_pty", { sessionId: ptyId, data: cdCmd }).catch(
        (err) => {
          log.warn(
            `[TerminalRepoSync] Failed to cd terminal ${session.id}:`,
            err
          );
        }
      );
    }
  }, [activeWorkspaceRootPath, sessions, initialized]);
}
