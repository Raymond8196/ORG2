import { atom } from "jotai";

import { destroyChatPanelTerminalAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";
import { chatPanelSelectedCloudOrgAtom } from "@src/store/ui/chatPanelAtom";

import {
  activateChatPanelTabAtom,
  transitionChatPanelTabPresentationAtom,
} from "./chatPanelTabPresentationAtoms";
import { buildDefaultLaunchpadTab } from "./chatPanelTabsModel";
import { chatPanelTabsAtom } from "./chatPanelTabsState";
import { disposeWorkManagementStateAtom } from "./disposeWorkManagementStateAtom";

/** Clear the cliCommand on a tab after it has been injected */
export const clearChatPanelTabCliCommandAtom = atom(
  null,
  (_get, set, tabId: string) => {
    set(chatPanelTabsAtom, (prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, cliCommand: undefined } : tab
      ),
    }));
  }
);
clearChatPanelTabCliCommandAtom.debugLabel = "clearChatPanelTabCliCommand";

/** Close a tab by ID. If it was active, move to the nearest neighbour. */
export const closeChatPanelTabAtom = atom(null, (get, set, tabId: string) => {
  const state = get(chatPanelTabsAtom);
  const idx = state.tabs.findIndex((tab) => tab.id === tabId);
  if (idx === -1) return;
  const tab = state.tabs[idx];
  if (tab.type === "work-management") {
    set(disposeWorkManagementStateAtom);
  }
  const nextTabs = state.tabs.filter((candidate) => candidate.id !== tabId);
  let nextActiveId = state.activeTabId;

  if (nextTabs.length === 0) {
    const launchpad = buildDefaultLaunchpadTab();
    set(transitionChatPanelTabPresentationAtom, {
      previousTab: tab,
      nextTab: launchpad,
    });
    set(chatPanelTabsAtom, {
      tabs: [launchpad],
      activeTabId: launchpad.id,
    });
    set(activateChatPanelTabAtom, launchpad.id);
    return;
  }

  if (state.activeTabId === tabId) {
    const nextIdx = Math.max(0, idx - 1);
    nextActiveId = nextTabs[Math.min(nextIdx, nextTabs.length - 1)].id;
    set(transitionChatPanelTabPresentationAtom, {
      previousTab: tab,
      nextTab: nextTabs.find((candidate) => candidate.id === nextActiveId),
    });
  }

  set(chatPanelTabsAtom, { tabs: nextTabs, activeTabId: nextActiveId });
  if (state.activeTabId === tabId) {
    set(activateChatPanelTabAtom, nextActiveId);
  }
});
closeChatPanelTabAtom.debugLabel = "closeChatPanelTab";

/** Close the singleton org-management tab, or clear a legacy bare surface. */
export const closeCloudOrgManagementChatPanelTabAtom = atom(
  null,
  (get, set) => {
    const tab = get(chatPanelTabsAtom).tabs.find(
      (candidate) => candidate.type === "cloud-org"
    );
    if (tab) {
      set(closeChatPanelTabAtom, tab.id);
      return;
    }
    set(chatPanelSelectedCloudOrgAtom, null);
  }
);
closeCloudOrgManagementChatPanelTabAtom.debugLabel =
  "closeCloudOrgManagementChatPanelTab";

/** Navigate to the next tab (wraps around) */
export const nextChatPanelTabAtom = atom(null, (get, set) => {
  const state = get(chatPanelTabsAtom);
  if (state.tabs.length === 0) return;
  const idx = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const nextIdx = ((idx === -1 ? 0 : idx) + 1) % state.tabs.length;
  set(activateChatPanelTabAtom, state.tabs[nextIdx].id);
});
nextChatPanelTabAtom.debugLabel = "nextChatPanelTab";

/** Navigate to the previous tab (wraps around) */
export const prevChatPanelTabAtom = atom(null, (get, set) => {
  const state = get(chatPanelTabsAtom);
  if (state.tabs.length === 0) return;
  const idx = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const currentIdx = idx === -1 ? 0 : idx;
  const prevIdx = (currentIdx - 1 + state.tabs.length) % state.tabs.length;
  set(activateChatPanelTabAtom, state.tabs[prevIdx].id);
});
prevChatPanelTabAtom.debugLabel = "prevChatPanelTab";

/** Reorder tabs within the Chat Panel strip without changing the active tab. */
export const reorderChatPanelTabsAtom = atom(
  null,
  (
    get,
    set,
    { startIndex, endIndex }: { startIndex: number; endIndex: number }
  ) => {
    const state = get(chatPanelTabsAtom);
    if (
      startIndex === endIndex ||
      startIndex < 0 ||
      endIndex < 0 ||
      startIndex >= state.tabs.length ||
      endIndex >= state.tabs.length
    ) {
      return;
    }
    const tabs = [...state.tabs];
    const [movedTab] = tabs.splice(startIndex, 1);
    tabs.splice(endIndex, 0, movedTab);
    set(chatPanelTabsAtom, { ...state, tabs });
  }
);
reorderChatPanelTabsAtom.debugLabel = "reorderChatPanelTabs";

/** Update the session ID on the given tab (called after session launch) */
export const setChatPanelTabSessionIdAtom = atom(
  null,
  (
    _get,
    set,
    { tabId, sessionId }: { tabId: string; sessionId: string | null }
  ) => {
    set(chatPanelTabsAtom, (prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, sessionId } : tab
      ),
    }));
  }
);

/** Update the title on the given tab */
export const setChatPanelTabTitleAtom = atom(
  null,
  (_get, set, { tabId, title }: { tabId: string; title: string }) => {
    set(chatPanelTabsAtom, (prev) => {
      if (prev.tabs.some((tab) => tab.id === tabId && tab.title === title)) {
        return prev;
      }

      const now = new Date().toISOString();
      return {
        ...prev,
        tabs: prev.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, title, updatedAt: now } : tab
        ),
      };
    });
  }
);

/** Toggle TUI mode on the given tab */
export const toggleChatPanelTabTuiModeAtom = atom(
  null,
  (_get, set, tabId: string) => {
    set(chatPanelTabsAtom, (prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, tuiMode: !tab.tuiMode } : tab
      ),
    }));
  }
);

/**
 * Close a tab AND, for terminal tabs, destroy the backing PTY and clear its
 * buffer cache slot. Use this instead of closeChatPanelTabAtom when the
 * caller has access to the Jotai store (i.e., inside React components).
 */
export const closeAndDestroyChatPanelTabAtom = atom(
  null,
  async (get, set, tabId: string): Promise<void> => {
    const state = get(chatPanelTabsAtom);
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    // Destroy PTY before removing the tab so the terminal session ID is still
    // reachable during cleanup.
    if (tab?.type === "terminal" && tab.terminalSessionId) {
      await set(destroyChatPanelTerminalAtom, tab.terminalSessionId);
    }
    set(closeChatPanelTabAtom, tabId);
  }
);
closeAndDestroyChatPanelTabAtom.debugLabel = "closeAndDestroyChatPanelTab";
