import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

import {
  activeChatPanelTabAtom,
  addChatPanelSessionTabAtom,
  addChatPanelTerminalTabAtom,
  chatPanelTabsAtom,
  setChatPanelTabSessionIdAtom,
  setChatPanelTabTitleAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import { createChatPanelTerminalAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";

import type { ChatPanelCliTerminalLaunchOptions } from "../types";

interface UseChatPanelTabsControllerOptions {
  currentSessionId: string | null;
  panelTitle: string;
  resetToSessionSurface: () => void;
  showSessionSurface: () => void;
}

export function useChatPanelTabsController({
  currentSessionId,
  panelTitle,
  resetToSessionSurface,
  showSessionSurface,
}: UseChatPanelTabsControllerOptions) {
  const setTabSessionId = useSetAtom(setChatPanelTabSessionIdAtom);
  const setTabTitle = useSetAtom(setChatPanelTabTitleAtom);
  const activeTab = useAtomValue(activeChatPanelTabAtom);
  const allTabs = useAtomValue(chatPanelTabsAtom).tabs;
  const addSessionTab = useSetAtom(addChatPanelSessionTabAtom);
  const addTerminalTab = useSetAtom(addChatPanelTerminalTabAtom);
  const createTerminalSession = useSetAtom(createChatPanelTerminalAtom);
  const activeTabId = activeTab?.id;
  const activeTabSessionId = activeTab?.sessionId;
  const activeTabTitle = activeTab?.title;
  const activeTabType = activeTab?.type;

  useEffect(() => {
    if (!activeTabId || activeTabType !== "session") return;
    if (!activeTabSessionId && currentSessionId) {
      setTabSessionId({
        tabId: activeTabId,
        sessionId: currentSessionId,
      });
    }
  }, [
    activeTabId,
    activeTabSessionId,
    activeTabType,
    currentSessionId,
    setTabSessionId,
  ]);

  useEffect(() => {
    if (!activeTabId || activeTabType !== "session") return;
    if (panelTitle && panelTitle !== activeTabTitle) {
      setTabTitle({ tabId: activeTabId, title: panelTitle });
    }
  }, [activeTabId, activeTabTitle, activeTabType, panelTitle, setTabTitle]);

  const handleNewTerminalTab = useCallback(() => {
    const terminalSessionId = createTerminalSession("Terminal");
    addTerminalTab(terminalSessionId);
  }, [addTerminalTab, createTerminalSession]);

  const handleOpenCliTerminal = useCallback(
    (options: ChatPanelCliTerminalLaunchOptions) => {
      const terminalSessionId = createTerminalSession({
        name: options.title,
        cwd: options.cwd,
        cliAgentType: options.cliAgentType,
        agentCommand: options.command,
        expectedProcess: options.expectedProcess,
      });
      addTerminalTab({
        terminalSessionId,
        title: options.title,
        cliCommand: options.command,
      });
      showSessionSurface();
    },
    [addTerminalTab, createTerminalSession, showSessionSurface]
  );

  const handleNewSessionTab = useCallback(() => {
    addSessionTab();
    resetToSessionSurface();
  }, [addSessionTab, resetToSessionSurface]);

  const isTerminalTabActive = activeTab?.type === "terminal";
  const terminalTabs = allTabs.filter(
    (tab) => tab.type === "terminal" && tab.terminalSessionId
  );

  return {
    activeTab,
    handleNewSessionTab,
    handleNewTerminalTab,
    handleOpenCliTerminal,
    isTerminalTabActive,
    terminalTabs,
  };
}
