import { atom } from "jotai";

import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import {
  CHAT_PANEL_START_PAGE_TAB,
  type ChatPanelSelectedCloudOrg,
  type ChatPanelSelectedWorkspace,
  type ChatPanelStartPageTab,
  type WorkspaceOverviewTab,
  chatPanelStartPageTabAtom,
  chatPanelWorkspaceOverviewTabAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  WORK_MANAGEMENT_SECTION,
  type WorkManagementSection,
} from "@src/store/workstation/workstationTabBarAtoms";

import {
  activateChatPanelTabAtom,
  appendAndActivateChatPanelTabAtom,
} from "./chatPanelTabPresentationAtoms";
import {
  type ChatPanelTab,
  getWorkManagementFallbackTitle,
} from "./chatPanelTabsModel";
import { chatPanelTabsAtom } from "./chatPanelTabsState";

/** Add a standalone Launchpad tab and show its Work / Manage / Trend page. */
export const addChatPanelLaunchpadTabAtom = atom(
  null,
  (_get, set, title: string = "Launchpad") => {
    const id = `launchpad-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    set(appendAndActivateChatPanelTabAtom, {
      tab: {
        id,
        type: "start-page",
        title,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }
);
addChatPanelLaunchpadTabAtom.debugLabel = "addChatPanelLaunchpadTab";

interface OpenOrFocusStartPageTabOptions {
  section?: ChatPanelStartPageTab;
  title?: string;
}

/**
 * Focus the singleton Launchpad start-page tab at the requested section, or
 * create it when none is open. This is the one entry point new-session and
 * launchpad triggers should use so they reuse the existing tab instead of
 * stacking duplicates.
 */
export const openOrFocusChatPanelStartPageTabAtom = atom(
  null,
  (get, set, options: OpenOrFocusStartPageTabOptions = {}) => {
    const { section = CHAT_PANEL_START_PAGE_TAB.WORK, title = "Launchpad" } =
      options;
    set(chatPanelStartPageTabAtom, section);
    const existingTab = get(chatPanelTabsAtom).tabs.find(
      (tab) => tab.type === "start-page"
    );
    if (existingTab) {
      set(activateChatPanelTabAtom, existingTab.id);
      return existingTab.id;
    }
    return set(addChatPanelLaunchpadTabAtom, title);
  }
);
openOrFocusChatPanelStartPageTabAtom.debugLabel =
  "openOrFocusChatPanelStartPageTab";

/** Focus the existing Launchpad at Manage, or create it when none is open. */
export const openOrFocusChatPanelManageTabAtom = atom(null, (_get, set) =>
  set(openOrFocusChatPanelStartPageTabAtom, {
    section: CHAT_PANEL_START_PAGE_TAB.MANAGE,
  })
);
openOrFocusChatPanelManageTabAtom.debugLabel = "openOrFocusChatPanelManageTab";

interface OpenKanbanTabOptions {
  section?: WorkManagementSection;
  title?: string;
}

/** Open or focus the singleton Kanban tab at the requested section. */
export const openKanbanChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenKanbanTabOptions = {}) => {
    const {
      section = WORK_MANAGEMENT_SECTION.KANBAN,
      title = getWorkManagementFallbackTitle(section),
    } = options;
    const state = get(chatPanelTabsAtom);
    const existingTab = state.tabs.find(
      (tab) => tab.type === "work-management"
    );
    if (existingTab) {
      set(chatPanelTabsAtom, {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id
            ? { ...tab, title, managementSection: section }
            : tab
        ),
      });
      set(activateChatPanelTabAtom, existingTab.id);
      return existingTab.id;
    }

    const id = "chat-work-management";
    const now = new Date().toISOString();
    const tab: ChatPanelTab = {
      id,
      type: "work-management",
      title,
      managementSection: section,
      createdAt: now,
      updatedAt: now,
    };
    set(appendAndActivateChatPanelTabAtom, { tab });
    return id;
  }
);
openKanbanChatPanelTabAtom.debugLabel = "openKanbanChatPanelTab";

interface OpenWorkspaceOverviewTabOptions {
  workspace: ChatPanelSelectedWorkspace;
  /** Overview sub-tab to land on (e.g. Details). Preserves current when omitted. */
  tab?: WorkspaceOverviewTab;
}

/**
 * Open — or focus, if already open — a dedicated chat-panel tab for a
 * workspace's overview / detail page. Each workspace gets its own pill titled
 * with the workspace name (not "Launchpad"); re-opening the same workspace
 * focuses the existing tab instead of stacking duplicates. The active tab
 * drives `chatPanelSelectedWorkspaceAtom` through `chatPanelNavigateAtom`,
 * which is what the overview surface actually renders from.
 */
export const openWorkspaceOverviewInChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenWorkspaceOverviewTabOptions) => {
    const { workspace, tab: overviewTab } = options;
    // Seed the requested sub-tab before activation: the navigate that runs on
    // activation passes no explicit tab, so it preserves this value.
    if (overviewTab) {
      set(chatPanelWorkspaceOverviewTabAtom, overviewTab);
    }

    const existingTab = get(chatPanelTabsAtom).tabs.find(
      (candidate) =>
        candidate.type === "workspace" &&
        candidate.workspace?.kind === workspace.kind &&
        candidate.workspace?.id === workspace.id
    );
    if (existingTab) {
      // Refresh the stored payload (name/path can drift) before focusing.
      set(chatPanelTabsAtom, (prev) => ({
        ...prev,
        tabs: prev.tabs.map((candidate) =>
          candidate.id === existingTab.id
            ? { ...candidate, title: workspace.name, workspace }
            : candidate
        ),
      }));
      set(activateChatPanelTabAtom, existingTab.id);
      return existingTab.id;
    }

    const id = `workspace-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    set(appendAndActivateChatPanelTabAtom, {
      tab: {
        id,
        type: "workspace",
        title: workspace.name,
        workspace,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }
);
openWorkspaceOverviewInChatPanelTabAtom.debugLabel =
  "openWorkspaceOverviewInChatPanelTab";

interface OpenCloudOrgManagementTabOptions {
  cloudOrg: ChatPanelSelectedCloudOrg;
  title?: string;
}

/**
 * Open or focus the singleton managed-cloud organization settings tab.
 * Switching organizations updates the tab payload in place, so its identity
 * remains "Manage ORG" and activating it restores the selected organization.
 */
export const openCloudOrgManagementInChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenCloudOrgManagementTabOptions) => {
    const { cloudOrg, title = "Manage ORG" } = options;
    const state = get(chatPanelTabsAtom);
    const existingTab = state.tabs.find((tab) => tab.type === "cloud-org");
    if (existingTab) {
      set(chatPanelTabsAtom, {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id ? { ...tab, title, cloudOrg } : tab
        ),
      });
      set(activateChatPanelTabAtom, existingTab.id);
      return existingTab.id;
    }

    const id = "chat-cloud-org-management";
    const now = new Date().toISOString();
    set(appendAndActivateChatPanelTabAtom, {
      tab: {
        id,
        type: "cloud-org",
        title,
        cloudOrg,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }
);
openCloudOrgManagementInChatPanelTabAtom.debugLabel =
  "openCloudOrgManagementInChatPanelTab";

interface OpenSessionInNewChatTabOptions {
  sessionId: string;
  sessionName?: string;
  repoPath?: string;
}

/**
 * Open an existing session in a new chat panel tab and make it the active
 * WorkStation session.
 */
export const openSessionInNewChatTabAtom = atom(
  null,
  (_get, set, optionsOrSessionId: OpenSessionInNewChatTabOptions | string) => {
    const options =
      typeof optionsOrSessionId === "string"
        ? { sessionId: optionsOrSessionId }
        : optionsOrSessionId;
    const { sessionId, sessionName, repoPath } = options;
    const id = `chat-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    set(appendAndActivateChatPanelTabAtom, {
      tab: {
        id,
        type: "session",
        title: sessionName ?? "Chat",
        createdAt: now,
        updatedAt: now,
        sessionId,
      },
      sessionName,
      repoPath,
    });
    return id;
  }
);
openSessionInNewChatTabAtom.debugLabel = "openSessionInNewChatTab";

/** Focus an existing tab for a session, or create one when none is open. */
export const openOrFocusSessionInChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenSessionInNewChatTabOptions) => {
    const existingTab = get(chatPanelTabsAtom).tabs.find(
      (tab) => tab.type === "session" && tab.sessionId === options.sessionId
    );
    if (existingTab) {
      set(activateChatPanelTabAtom, {
        tabId: existingTab.id,
        sessionName: options.sessionName,
        repoPath: options.repoPath,
      });
      return existingTab.id;
    }

    return set(openSessionInNewChatTabAtom, options);
  }
);
openOrFocusSessionInChatPanelTabAtom.debugLabel =
  "openOrFocusSessionInChatPanelTab";

/**
 * Open a session from the sidebar without stacking tabs during normal
 * navigation. An already-open target is focused; otherwise the active session
 * tab is repointed to the target. Non-session tabs are never replaced.
 */
export const openOrReplaceSessionInChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenSessionInNewChatTabOptions) => {
    const state = get(chatPanelTabsAtom);
    const existingTab = state.tabs.find(
      (tab) => tab.type === "session" && tab.sessionId === options.sessionId
    );
    if (existingTab) {
      set(activateChatPanelTabAtom, {
        tabId: existingTab.id,
        sessionName: options.sessionName,
        repoPath: options.repoPath,
      });
      return existingTab.id;
    }

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (activeTab?.type !== "session") {
      return set(openSessionInNewChatTabAtom, options);
    }

    const session = get(sessionByIdAtom(options.sessionId));
    const replacementTab: ChatPanelTab = {
      ...activeTab,
      title: options.sessionName ?? session?.name ?? "Chat",
      sessionId: options.sessionId,
      updatedAt: new Date().toISOString(),
    };
    set(chatPanelTabsAtom, {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === activeTab.id ? replacementTab : tab
      ),
    });
    set(activateChatPanelTabAtom, {
      tabId: activeTab.id,
      sessionName: options.sessionName,
      repoPath: options.repoPath,
    });
    return activeTab.id;
  }
);
openOrReplaceSessionInChatPanelTabAtom.debugLabel =
  "openOrReplaceSessionInChatPanelTab";

interface AddTerminalTabOptions {
  terminalSessionId: string;
  title?: string;
  /** CLI binary command to write to the PTY once the shell is ready (e.g. "claude") */
  cliCommand?: string;
}

/** Add a new terminal tab, using the provided terminal session ID */
export const addChatPanelTerminalTabAtom = atom(
  null,
  (_get, set, optionsOrId: AddTerminalTabOptions | string) => {
    const {
      terminalSessionId,
      title = "Terminal",
      cliCommand,
    } = typeof optionsOrId === "string"
      ? { terminalSessionId: optionsOrId }
      : optionsOrId;
    const id = `terminal-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    set(appendAndActivateChatPanelTabAtom, {
      tab: {
        id,
        type: "terminal",
        title,
        createdAt: now,
        updatedAt: now,
        terminalSessionId,
        cliCommand,
      },
    });
    return id;
  }
);
addChatPanelTerminalTabAtom.debugLabel = "addChatPanelTerminalTab";
