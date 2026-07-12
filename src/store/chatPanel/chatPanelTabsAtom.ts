/**
 * Chat Panel Tab Store
 *
 * Multi-tab state for the chat panel. Each tab is one of:
 *   "session"  — AI agent session chat history
 *   "terminal" — Live PTY terminal embedded in the chat pane
 *   "start-page" — Launchpad with Work / Manage / Trend tabs
 *   "ops-control" — Singleton management surface with internal sections
 *
 * Terminal tabs share the global terminal atom store but use session IDs
 * prefixed with "chatpanel-" so they are invisible to the Workstation
 * terminal manager.
 *
 * Performance contract:
 *   - `atomWithStorage` with a debounced write avoids blocking the UI on
 *     every tab switch. The 400 ms debounce matches the pattern used by
 *     chatWidthAtom and workstationLayoutAtom.
 *   - Tab content is lazy-rendered: only the active tab mounts heavyweight
 *     components (TerminalCore, ChatView). Inactive tabs keep their atoms
 *     alive but their React trees are hidden (not unmounted) via CSS so that
 *     PTY processes stay connected and chat history is not lost.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import { destroyChatPanelTerminalAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import {
  activeSessionIdAtom,
  jumpToSessionAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import {
  CHAT_PANEL_START_PAGE_TAB,
  CHAT_PANEL_SURFACE_KIND,
  chatPanelMaximizedAtom,
  chatPanelNavigateAtom,
  chatPanelStartPageOpenAtom,
  chatPanelStartPageTabAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  OPS_CONTROL_HOME_TAB,
  type OpsControlHomeTab,
} from "@src/store/workstation/workstationTabBarAtoms";

import { disposeOpsControlStateAtom } from "./disposeOpsControlStateAtom";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ChatPanelTabType =
  | "session"
  | "terminal"
  | "start-page"
  | "ops-control";

export interface ChatPanelTab {
  id: string;
  type: ChatPanelTabType;
  /** Display label */
  title: string;
  /** Active inner section for the singleton Ops Control tab. */
  opsSection?: OpsControlHomeTab;
  createdAt?: string;
  updatedAt?: string;
  /**
   * For "session" tabs: the linked ORGII session ID.
   * Legacy persisted empty tabs may still hydrate with null before migration.
   */
  sessionId?: string | null;
  /**
   * For "terminal" tabs: the terminal session ID in the shared terminal
   * atom store. Always prefixed "chatpanel-<uuid>" to isolate from
   * Workstation terminals.
   */
  terminalSessionId?: string;
  /**
   * When true the terminal / session output is forced through xterm.js
   * instead of ansi-to-react.
   */
  tuiMode?: boolean;
  /**
   * For "terminal" tabs opened via the CLI launch bar: the bare binary command
   * to write to the PTY once the shell prompt is ready (e.g. "claude\n").
   * Written once after the PTY reports initialized; cleared afterwards.
   */
  cliCommand?: string;
}

const FULLSCREEN_ONLY_CHAT_PANEL_TAB_TYPES = new Set<ChatPanelTabType>([
  "ops-control",
]);

export function isChatPanelTabFullscreenOnly(
  tabOrType: ChatPanelTab | ChatPanelTabType | null | undefined
): boolean {
  const type =
    typeof tabOrType === "string" ? tabOrType : (tabOrType?.type ?? null);
  return type !== null && FULLSCREEN_ONLY_CHAT_PANEL_TAB_TYPES.has(type);
}

export interface ChatPanelTabsState {
  tabs: ChatPanelTab[];
  activeTabId: string;
}

export function normalizePersistedChatPanelTabsState(
  value: unknown
): ChatPanelTabsState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ChatPanelTabsState>;
  if (!Array.isArray(candidate.tabs)) return null;

  const mappedTabs = candidate.tabs
    .filter((tab) => tab.type !== "terminal")
    .map((tab) => {
      const persistedType = (tab as { type: string }).type;
      if (persistedType === "session" && !tab.sessionId) {
        return {
          ...tab,
          type: "start-page",
          title: "Launchpad",
        } as ChatPanelTab;
      }
      if (persistedType === "launchpad" || persistedType === "dashboard") {
        return {
          ...tab,
          type: "start-page",
          title: "Launchpad",
        } as ChatPanelTab;
      }
      if (persistedType === "ops-projects") {
        return {
          ...tab,
          type: "ops-control",
          title: "Ops Control",
          opsSection: OPS_CONTROL_HOME_TAB.PROJECTS,
        } as ChatPanelTab;
      }
      if (persistedType === "ops-control") {
        return {
          ...tab,
          opsSection: tab.opsSection ?? OPS_CONTROL_HOME_TAB.OPS_CONTROL,
        } as ChatPanelTab;
      }
      return tab;
    });

  const activeMappedTab = mappedTabs.find(
    (tab) => tab.id === candidate.activeTabId
  );
  const preferredOpsControlTabId =
    activeMappedTab?.type === "ops-control"
      ? activeMappedTab.id
      : mappedTabs.find((tab) => tab.type === "ops-control")?.id;
  const survivingTabs = mappedTabs.filter(
    (tab) => tab.type !== "ops-control" || tab.id === preferredOpsControlTabId
  );
  if (survivingTabs.length === 0) return null;

  const activeTabId = survivingTabs.some(
    (tab) => tab.id === candidate.activeTabId
  )
    ? (candidate.activeTabId as string)
    : survivingTabs[0].id;
  return { tabs: survivingTabs, activeTabId };
}

// ────────────────────────────────────────────────────────────────────────────
// Debounced storage (400 ms, matching other high-frequency panel atoms)
// ────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "orgii:chatPanelTabs";
const WRITE_DEBOUNCE_MS = 400;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const debouncedStorage = {
  getItem(key: string): ChatPanelTabsState {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const normalized = normalizePersistedChatPanelTabsState(
          JSON.parse(raw)
        );
        if (normalized) return normalized;
      }
    } catch {
      // fall through to default
    }
    return buildInitialState();
  },
  setItem(key: string, value: ChatPanelTabsState): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Ignore write errors
      }
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
  },
  subscribe(
    _key: string,
    _callback: (value: ChatPanelTabsState) => void
  ): () => void {
    return () => undefined;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Initial state factory
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_LAUNCHPAD_TAB_ID = "launchpad-default";

function buildDefaultLaunchpadTab(): ChatPanelTab {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_LAUNCHPAD_TAB_ID,
    type: "start-page",
    title: "Launchpad",
    createdAt: now,
    updatedAt: now,
  };
}

function buildInitialState(): ChatPanelTabsState {
  const launchpad = buildDefaultLaunchpadTab();
  return {
    tabs: [launchpad],
    activeTabId: launchpad.id,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Core atom
// ────────────────────────────────────────────────────────────────────────────

export const chatPanelTabsAtom = atomWithStorage<ChatPanelTabsState>(
  STORAGE_KEY,
  buildInitialState(),
  debouncedStorage
);
chatPanelTabsAtom.debugLabel = "chatPanelTabs";

// ────────────────────────────────────────────────────────────────────────────
// Derived read atoms
// ────────────────────────────────────────────────────────────────────────────

export const activeChatPanelTabAtom = atom((get) => {
  const state = get(chatPanelTabsAtom);
  return (
    state.tabs.find((tab) => tab.id === state.activeTabId) ??
    state.tabs[0] ??
    null
  );
});
activeChatPanelTabAtom.debugLabel = "activeChatPanelTab";

/**
 * Ops Control content and sidebar selection are projections of the active
 * ChatPanel tab. Keeping this derived prevents tab chrome, content, and
 * sidebar state from drifting independently.
 */
export const activeOpsControlHomeTabAtom = atom(
  (get) =>
    get(activeChatPanelTabAtom)?.opsSection ?? OPS_CONTROL_HOME_TAB.OPS_CONTROL
);
activeOpsControlHomeTabAtom.debugLabel = "activeOpsControlHomeTab";

export const chatPanelTabCountAtom = atom(
  (get) => get(chatPanelTabsAtom).tabs.length
);

/** Maximize-state snapshot taken before entering a full-screen-only tab. */
const fullscreenTabPriorMaximizedAtom = atom<boolean | null>(null);

const transitionChatPanelTabPresentationAtom = atom(
  null,
  (
    get,
    set,
    {
      previousTab,
      nextTab,
    }: {
      previousTab: ChatPanelTab | null | undefined;
      nextTab: ChatPanelTab | null | undefined;
    }
  ) => {
    const previousFullscreen = isChatPanelTabFullscreenOnly(previousTab);
    const nextFullscreen = isChatPanelTabFullscreenOnly(nextTab);

    if (nextFullscreen) {
      if (!previousFullscreen) {
        set(fullscreenTabPriorMaximizedAtom, get(chatPanelMaximizedAtom));
      }
      if (!get(chatPanelMaximizedAtom)) {
        set(chatPanelMaximizedAtom, true);
      }
      return;
    }

    if (previousFullscreen) {
      set(
        chatPanelMaximizedAtom,
        get(fullscreenTabPriorMaximizedAtom) ?? false
      );
      set(fullscreenTabPriorMaximizedAtom, null);
    }
  }
);

/** Make the active tab's legacy surface atoms match its canonical identity. */
const syncChatPanelTabNavigationAtom = atom(
  null,
  (_get, set, tab: ChatPanelTab | null | undefined) => {
    if (!tab) return;

    if (tab.type === "start-page") {
      set(chatPanelNavigateAtom, { kind: CHAT_PANEL_SURFACE_KIND.SESSION });
      set(chatPanelStartPageOpenAtom, true);
      set(jumpToSessionAtom, null);
      return;
    }

    set(chatPanelStartPageOpenAtom, false);

    // Session is the neutral legacy surface underneath tabs whose content is
    // owned by ChatPanelShell (management and terminal tabs).
    set(chatPanelNavigateAtom, { kind: CHAT_PANEL_SURFACE_KIND.SESSION });
    if (tab.type !== "session") set(jumpToSessionAtom, null);
  }
);

/**
 * Reconcile presentation and legacy surface state after hydration or layout
 * changes. All interactive activation paths use the same synchronization.
 */
export const syncActiveChatPanelTabStateAtom = atom(null, (get, set) => {
  const state = get(chatPanelTabsAtom);
  const activeTab =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const priorMaximized = get(fullscreenTabPriorMaximizedAtom);

  set(syncChatPanelTabNavigationAtom, activeTab);

  if (isChatPanelTabFullscreenOnly(activeTab)) {
    if (priorMaximized === null) {
      set(fullscreenTabPriorMaximizedAtom, get(chatPanelMaximizedAtom));
    }
    if (!get(chatPanelMaximizedAtom)) {
      set(chatPanelMaximizedAtom, true);
    }
    return;
  }

  if (priorMaximized !== null) {
    set(chatPanelMaximizedAtom, priorMaximized);
    set(fullscreenTabPriorMaximizedAtom, null);
  }
});
syncActiveChatPanelTabStateAtom.debugLabel = "syncActiveChatPanelTabState";

// ────────────────────────────────────────────────────────────────────────────
// Write-only action atoms
// ────────────────────────────────────────────────────────────────────────────

interface ActivateChatPanelTabOptions {
  tabId: string;
  sessionName?: string;
  repoPath?: string;
}

function getActivateTabOptions(
  optionsOrTabId: ActivateChatPanelTabOptions | string
): ActivateChatPanelTabOptions {
  return typeof optionsOrTabId === "string"
    ? { tabId: optionsOrTabId }
    : optionsOrTabId;
}

/** Switch to a tab by ID and sync session state for linked session tabs. */
export const activateChatPanelTabAtom = atom(
  null,
  (get, set, optionsOrTabId: ActivateChatPanelTabOptions | string) => {
    const { tabId, sessionName, repoPath } =
      getActivateTabOptions(optionsOrTabId);
    const state = get(chatPanelTabsAtom);
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    const previousTab =
      state.tabs.find((candidate) => candidate.id === state.activeTabId) ??
      null;

    if (state.activeTabId !== tabId) {
      set(chatPanelTabsAtom, { ...state, activeTabId: tabId });
    }
    set(transitionChatPanelTabPresentationAtom, {
      previousTab,
      nextTab: tab,
    });

    set(syncChatPanelTabNavigationAtom, tab);

    if (tab.type === "start-page") {
      return;
    }

    if (tab.type === "terminal" || tab.type === "ops-control") {
      return;
    }

    const sessionId = tab.type === "session" ? tab.sessionId : null;
    if (
      sessionId &&
      (get(workstationActiveSessionIdAtom) !== sessionId ||
        get(activeSessionIdAtom) !== sessionId)
    ) {
      const session = get(sessionByIdAtom(sessionId));
      set(jumpToSessionAtom, {
        sessionId,
        sessionName: sessionName ?? session?.name,
        repoPath: repoPath ?? session?.repoPath,
      });
    }
  }
);
activateChatPanelTabAtom.debugLabel = "activateChatPanelTab";

interface AppendAndActivateChatPanelTabOptions {
  tab: ChatPanelTab;
  sessionName?: string;
  repoPath?: string;
}

/** Append a tab and run the same presentation/navigation activation chain. */
const appendAndActivateChatPanelTabAtom = atom(
  null,
  (
    get,
    set,
    { tab, sessionName, repoPath }: AppendAndActivateChatPanelTabOptions
  ) => {
    const state = get(chatPanelTabsAtom);
    const previousTab =
      state.tabs.find((candidate) => candidate.id === state.activeTabId) ??
      null;

    set(transitionChatPanelTabPresentationAtom, {
      previousTab,
      nextTab: tab,
    });
    set(chatPanelTabsAtom, {
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    });
    set(activateChatPanelTabAtom, {
      tabId: tab.id,
      sessionName,
      repoPath,
    });
  }
);

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

/** Focus the existing Launchpad at Manage, or create it when none is open. */
export const openOrFocusChatPanelManageTabAtom = atom(null, (get, set) => {
  set(chatPanelStartPageTabAtom, CHAT_PANEL_START_PAGE_TAB.MANAGE);
  const existingTab = get(chatPanelTabsAtom).tabs.find(
    (tab) => tab.type === "start-page"
  );
  if (existingTab) {
    set(activateChatPanelTabAtom, existingTab.id);
    return existingTab.id;
  }
  return set(addChatPanelLaunchpadTabAtom, "Launchpad");
});
openOrFocusChatPanelManageTabAtom.debugLabel = "openOrFocusChatPanelManageTab";

interface OpenOpsControlTabOptions {
  section?: OpsControlHomeTab;
  title?: string;
}

/** Open or focus the singleton Ops Control tab at the requested section. */
export const openOpsControlChatPanelTabAtom = atom(
  null,
  (get, set, options: OpenOpsControlTabOptions = {}) => {
    const {
      section = OPS_CONTROL_HOME_TAB.OPS_CONTROL,
      title = "Ops Control",
    } = options;
    const state = get(chatPanelTabsAtom);
    const existingTab = state.tabs.find((tab) => tab.type === "ops-control");
    if (existingTab) {
      set(chatPanelTabsAtom, {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id
            ? { ...tab, title, opsSection: section }
            : tab
        ),
      });
      set(activateChatPanelTabAtom, existingTab.id);
      return existingTab.id;
    }

    const id = "chat-ops-control";
    const now = new Date().toISOString();
    const tab: ChatPanelTab = {
      id,
      type: "ops-control",
      title,
      opsSection: section,
      createdAt: now,
      updatedAt: now,
    };
    set(appendAndActivateChatPanelTabAtom, { tab });
    return id;
  }
);
openOpsControlChatPanelTabAtom.debugLabel = "openOpsControlChatPanelTab";

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
  if (tab.type === "ops-control") {
    set(disposeOpsControlStateAtom);
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
    const now = new Date().toISOString();
    set(chatPanelTabsAtom, (prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, title, updatedAt: now } : tab
      ),
    }));
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
    const tab = state.tabs.find((t) => t.id === tabId);
    // Destroy PTY before removing the tab so the terminal session ID is still
    // reachable during cleanup.
    if (tab?.type === "terminal" && tab.terminalSessionId) {
      await set(destroyChatPanelTerminalAtom, tab.terminalSessionId);
    }
    set(closeChatPanelTabAtom, tabId);
  }
);
closeAndDestroyChatPanelTabAtom.debugLabel = "closeAndDestroyChatPanelTab";
