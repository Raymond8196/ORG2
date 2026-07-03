/**
 * ChatPanelTerminalContent
 *
 * Renders a live PTY terminal inside the chat pane for a single terminal tab.
 *
 * Architecture:
 *   - Each chat-pane terminal tab has a unique terminal session ID prefixed
 *     "chatpanel-" in the shared terminal atom store.
 *   - This component builds a synthetic `UseTerminalStateReturn` that scopes
 *     the shared global terminal atoms down to the single session for this tab.
 *   - The same TerminalCore / TerminalInteractive / PTY pipeline used by the
 *     Workstation is reused — no duplication.
 *
 * Performance:
 *   - `useAtomValue(terminalSessionsAtom)` re-renders this component when any
 *     terminal session changes. Since the sessions list is small and the render
 *     is cheap (just a memo lookup), this is acceptable. The TerminalView
 *     instances themselves are DOM-managed by xterm.js and do not re-render.
 *   - `useTerminalProcessPoller` polls every 2 s for the active terminal's
 *     process info. This is the same cadence used by the Workstation terminal
 *     panel — no additional polling is introduced here.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import { TerminalCore } from "@src/engines/TerminalCore";
import type {
  AddSessionOptions,
  UseTerminalStateReturn,
} from "@src/engines/TerminalCore/types";
import { createLogger } from "@src/hooks/logger";
import {
  clearChatPanelTabCliCommandAtom,
  setChatPanelTabTitleAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  initializedTerminalIdsAtom,
  markTerminalInitializedAtom,
  terminalSessionsAtom,
  updateTerminalSessionInfoAtom,
} from "@src/store/chatPanel/chatPanelTerminalAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { toBackendPtySessionId } from "@src/util/ui/terminal/ptySessionId";

const logger = createLogger("ChatPanelTerminalContent");

// ─── Props ─────────────────────────────────────────────────────────────────

interface ChatPanelTerminalContentProps {
  /** Tab ID — used to sync title when the terminal title changes */
  tabId: string;
  /** Terminal session ID in the shared terminal atom store */
  terminalSessionId: string;
  /**
   * CLI agent binary command to inject into the PTY shell once it's ready.
   * Written once with a trailing newline then cleared from the tab state.
   */
  cliCommand?: string;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ChatPanelTerminalContent({
  tabId,
  terminalSessionId,
  cliCommand,
  className = "",
}: ChatPanelTerminalContentProps): React.ReactNode {
  const allSessions = useAtomValue(terminalSessionsAtom);
  const initializedIds = useAtomValue(initializedTerminalIdsAtom);
  const dispatchMarkInitialized = useSetAtom(markTerminalInitializedAtom);
  const dispatchUpdateInfo = useSetAtom(updateTerminalSessionInfoAtom);
  const setTabTitle = useSetAtom(setChatPanelTabTitleAtom);
  const clearCliCommand = useSetAtom(clearChatPanelTabCliCommandAtom);

  // Find this tab's session
  const session = useMemo(
    () => allSessions.find((sess) => sess.id === terminalSessionId),
    [allSessions, terminalSessionId]
  );

  // Sync terminal title → tab title whenever the session name changes
  useEffect(() => {
    if (session?.name) {
      setTabTitle({ tabId, title: session.name });
    }
  }, [session?.name, tabId, setTabTitle]);

  // Track whether we've already injected the CLI command to avoid double-write
  const injectedRef = useRef(false);

  // Once the PTY is initialized and a CLI command is pending, write it to the shell
  useEffect(() => {
    if (!cliCommand || injectedRef.current) return;
    if (!initializedIds.has(terminalSessionId)) return;

    injectedRef.current = true;
    const ptySessionId = toBackendPtySessionId(terminalSessionId);

    // Small delay so the shell prompt has time to render before we send input
    const timerId = window.setTimeout(() => {
      invokeTauri("write_pty", {
        sessionId: ptySessionId,
        data: `${cliCommand}\n`,
      }).catch((err: unknown) => {
        logger.warn("Failed to inject CLI command into PTY", err);
      });
      clearCliCommand(tabId);
    }, 300);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [cliCommand, terminalSessionId, initializedIds, tabId, clearCliCommand]);

  // ── Synthetic terminalState scoped to this single session ──────────────

  const sessions = useMemo(() => (session ? [session] : []), [session]);

  const addSession = useCallback(
    (_options?: AddSessionOptions): string => {
      // Single-session mode: adding is a no-op; return the existing ID
      return terminalSessionId;
    },
    [terminalSessionId]
  );

  const closeSession = useCallback((_sessionId: string): void => {
    // Closing is handled at the tab level (closeChatPanelTabAtom → unmount → destroyTerminal)
  }, []);

  const setActiveSession = useCallback((_sessionId: string): void => {
    // Single-session view — nothing to switch
  }, []);

  const markSessionInitialized = useCallback(
    (sessionId: string): void => {
      dispatchMarkInitialized(sessionId);
    },
    [dispatchMarkInitialized]
  );

  const updateSessionInfo: UseTerminalStateReturn["updateSessionInfo"] =
    useCallback(
      (sessionId, info) => {
        dispatchUpdateInfo({ sessionId, info });
      },
      [dispatchUpdateInfo]
    );

  const renameSession = useCallback(
    (_sessionId: string, _title: string): void => {
      // Not exposed in chat pane terminal for now
    },
    []
  );

  const terminalState = useMemo<UseTerminalStateReturn>(
    () => ({
      sessions,
      activeSessionId: terminalSessionId,
      activeSession: session,
      initializedSessions: initializedIds,
      addSession,
      closeSession,
      setActiveSession,
      markSessionInitialized,
      updateSessionInfo,
      renameSession,
    }),
    [
      sessions,
      terminalSessionId,
      session,
      initializedIds,
      addSession,
      closeSession,
      setActiveSession,
      markSessionInitialized,
      updateSessionInfo,
      renameSession,
    ]
  );

  if (!session) {
    return (
      <div
        className={`flex items-center justify-center text-[13px] text-text-3 ${className}`}
      >
        Terminal session not found.
      </div>
    );
  }

  return (
    <TerminalCore
      terminalState={terminalState}
      className={`terminal-core min-h-0 flex-1 ${className}`}
    />
  );
}
