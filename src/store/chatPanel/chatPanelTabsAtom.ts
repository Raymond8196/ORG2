/**
 * Chat Panel Tab Store
 *
 * Multi-tab state for the chat panel. Each tab is one of:
 *   "session"  — AI agent session (chat history + session creator)
 *   "terminal" — Live PTY terminal embedded in the chat pane
 *   "launchpad" — Workspace dashboard surface
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
  CHAT_PANEL_SURFACE_KIND,
  chatPanelNavigateAtom,
} from "@src/store/ui/chatPanelAtom";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ChatPanelTabType = "session" | "terminal" | "launchpad";

export interface ChatPanelTab {
  id: string;
  type: ChatPanelTabType;
  /** Display label */
  title: string;
  createdAt?: string;
  updatedAt?: string;
  /** Set to true for the initial default session tab so Cmd+W skips it */
  isPrimary?: boolean;
  /** true means the × button is hidden */
  closable: boolean;
  /**
   * For "session" tabs: the ORGII session ID once a session is launched.
   * Null for the creator (empty) state.
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

export interface ChatPanelTabsState {
  tabs: ChatPanelTab[];
  activeTabId: string;
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
        const parsed = JSON.parse(raw) as ChatPanelTabsState;
        if (parsed && Array.isArray(parsed.tabs)) {
          // Strip terminal tabs — their PTY sessions don't survive reload.
          const survivingTabs = parsed.tabs.filter(
            (tab) => tab.type === "session"
          );
          if (survivingTabs.length > 0) {
            const activeId = survivingTabs.some(
              (tab) => tab.id === parsed.activeTabId
            )
              ? parsed.activeTabId
              : survivingTabs[0].id;
            return { tabs: survivingTabs, activeTabId: activeId };
          }
        }
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

const PRIMARY_TAB_ID = "chat-primary";

function buildInitialState(): ChatPanelTabsState {
  const now = new Date().toISOString();
  return {
    tabs: [
      {
        id: PRIMARY_TAB_ID,
        type: "session",
        title: "Chat",
        createdAt: now,
        updatedAt: now,
        isPrimary: true,
        closable: false,
        sessionId: null,
      },
    ],
    activeTabId: PRIMARY_TAB_ID,
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

export const chatPanelTabCountAtom = atom(
  (get) => get(chatPanelTabsAtom).tabs.length
);

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

    if (state.activeTabId !== tabId) {
      set(chatPanelTabsAtom, { ...state, activeTabId: tabId });
    }

    if (tab.type === "launchpad") {
      set(chatPanelNavigateAtom, {
        kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_DASHBOARD,
      });
      set(jumpToSessionAtom, null);
      return;
    }

    if (tab.type === "session") {
      set(chatPanelNavigateAtom, { kind: CHAT_PANEL_SURFACE_KIND.SESSION });
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

/** Add a new session tab and activate it */
export const addChatPanelSessionTabAtom = atom(null, (_get, set) => {
  const id = `chat-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  set(chatPanelTabsAtom, (prev) => ({
    tabs: [
      ...prev.tabs,
      {
        id,
        type: "session" as const,
        title: "Chat",
        createdAt: now,
        updatedAt: now,
        closable: true,
        sessionId: null,
      },
    ],
    activeTabId: id,
  }));
  return id;
});
addChatPanelSessionTabAtom.debugLabel = "addChatPanelSessionTab";

/** Add a standalone Launchpad tab and activate its dashboard surface. */
export const addChatPanelLaunchpadTabAtom = atom(
  null,
  (_get, set, title: string = "Launchpad") => {
    const id = `launchpad-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    set(chatPanelTabsAtom, (prev) => ({
      tabs: [
        ...prev.tabs,
        {
          id,
          type: "launchpad" as const,
          title,
          createdAt: now,
          updatedAt: now,
          closable: true,
        },
      ],
      activeTabId: id,
    }));
    set(activateChatPanelTabAtom, id);
    return id;
  }
);
addChatPanelLaunchpadTabAtom.debugLabel = "addChatPanelLaunchpadTab";

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
    set(chatPanelTabsAtom, (prev) => ({
      tabs: [
        ...prev.tabs,
        {
          id,
          type: "session" as const,
          title: "Chat",
          createdAt: now,
          updatedAt: now,
          closable: true,
          sessionId,
        },
      ],
      activeTabId: id,
    }));
    set(activateChatPanelTabAtom, { tabId: id, sessionName, repoPath });
    return id;
  }
);
openSessionInNewChatTabAtom.debugLabel = "openSessionInNewChatTab";

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
    set(chatPanelTabsAtom, (prev) => ({
      tabs: [
        ...prev.tabs,
        {
          id,
          type: "terminal" as const,
          title,
          createdAt: now,
          updatedAt: now,
          closable: true,
          terminalSessionId,
          cliCommand,
        },
      ],
      activeTabId: id,
    }));
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
  if (!tab.closable) return;

  const nextTabs = state.tabs.filter((candidate) => candidate.id !== tabId);
  let nextActiveId = state.activeTabId;

  if (nextTabs.length === 0) {
    const now = new Date().toISOString();
    const primary: ChatPanelTab = {
      id: PRIMARY_TAB_ID,
      type: "session",
      title: "Chat",
      createdAt: now,
      updatedAt: now,
      isPrimary: true,
      closable: false,
      sessionId: null,
    };
    set(chatPanelTabsAtom, { tabs: [primary], activeTabId: PRIMARY_TAB_ID });
    return;
  }

  if (state.activeTabId === tabId) {
    const nextIdx = Math.max(0, idx - 1);
    nextActiveId = nextTabs[Math.min(nextIdx, nextTabs.length - 1)].id;
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
