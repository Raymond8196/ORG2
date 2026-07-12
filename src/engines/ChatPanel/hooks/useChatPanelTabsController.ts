import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

import {
  activeChatPanelTabAtom,
  addChatPanelLaunchpadTabAtom,
  addChatPanelTerminalTabAtom,
  chatPanelTabsAtom,
  openOpsControlChatPanelTabAtom,
  setChatPanelTabSessionIdAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import { createChatPanelTerminalAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";
import {
  CHAT_PANEL_START_PAGE_TAB,
  chatPanelStartPageTabAtom,
} from "@src/store/ui/chatPanelAtom";
import { OPS_CONTROL_HOME_TAB } from "@src/store/workstation";

import type { ChatPanelCliTerminalLaunchOptions } from "../types";

interface UseChatPanelTabsControllerOptions {
  currentSessionId: string | null;
  launchpadTitle: string;
  opsControlTitle: string;
  showSessionSurface: () => void;
}

export function useChatPanelTabsController({
  currentSessionId,
  launchpadTitle,
  opsControlTitle,
  showSessionSurface,
}: UseChatPanelTabsControllerOptions) {
  const setTabSessionId = useSetAtom(setChatPanelTabSessionIdAtom);
  const activeTab = useAtomValue(activeChatPanelTabAtom);
  const allTabs = useAtomValue(chatPanelTabsAtom).tabs;
  const addLaunchpadTab = useSetAtom(addChatPanelLaunchpadTabAtom);
  const addTerminalTab = useSetAtom(addChatPanelTerminalTabAtom);
  const openOpsControlTab = useSetAtom(openOpsControlChatPanelTabAtom);
  const setStartPageTab = useSetAtom(chatPanelStartPageTabAtom);
  const createTerminalSession = useSetAtom(createChatPanelTerminalAtom);
  const activeTabId = activeTab?.id;
  const activeTabSessionId = activeTab?.sessionId;
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
    setStartPageTab(CHAT_PANEL_START_PAGE_TAB.WORK);
    addLaunchpadTab(launchpadTitle);
  }, [addLaunchpadTab, launchpadTitle, setStartPageTab]);

  const handleOpenLaunchpadTab = useCallback(() => {
    setStartPageTab(CHAT_PANEL_START_PAGE_TAB.WORK);
    addLaunchpadTab(launchpadTitle);
  }, [addLaunchpadTab, launchpadTitle, setStartPageTab]);

  const handleOpenOpsControlTab = useCallback(() => {
    openOpsControlTab({
      section: OPS_CONTROL_HOME_TAB.OPS_CONTROL,
      title: opsControlTitle,
    });
  }, [openOpsControlTab, opsControlTitle]);

  const isTerminalTabActive = activeTab?.type === "terminal";
  const terminalTabs = allTabs.filter(
    (tab) => tab.type === "terminal" && tab.terminalSessionId
  );

  return {
    activeTab,
    handleNewSessionTab,
    handleNewTerminalTab,
    handleOpenCliTerminal,
    handleOpenLaunchpadTab,
    handleOpenOpsControlTab,
    isTerminalTabActive,
    terminalTabs,
  };
}
