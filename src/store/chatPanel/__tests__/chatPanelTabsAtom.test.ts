import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@src/store/session/sessionAtom/types";

function makeSession(
  sessionId: string,
  overrides: Partial<Session> = {}
): Session {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    session_id: sessionId,
    status: "completed",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function loadChatPanelTabAtoms() {
  const { createInstrumentedStore } =
    await import("@src/util/core/state/instrumentedStore");
  const store = createInstrumentedStore();
  const { activeSessionIdAtom, sessionViewAtom } =
    await import("@src/store/session/viewAtom");
  const { sessionsAtom } = await import("@src/store/session/sessionAtom");
  const {
    activateChatPanelTabAtom,
    addChatPanelLaunchpadTabAtom,
    chatPanelTabsAtom,
    closeChatPanelTabAtom,
    openSessionInNewChatTabAtom,
    prevChatPanelTabAtom,
  } = await import("../chatPanelTabsAtom");
  const { activeChatPanelSurfaceAtom, CHAT_PANEL_SURFACE_KIND } =
    await import("@src/store/ui/chatPanelAtom");

  return {
    activateChatPanelTabAtom,
    activeChatPanelSurfaceAtom,
    activeSessionIdAtom,
    addChatPanelLaunchpadTabAtom,
    CHAT_PANEL_SURFACE_KIND,
    chatPanelTabsAtom,
    closeChatPanelTabAtom,
    openSessionInNewChatTabAtom,
    prevChatPanelTabAtom,
    sessionViewAtom,
    sessionsAtom,
    store,
  };
}

describe("addChatPanelLaunchpadTabAtom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.removeItem("orgii:chatPanelTabs");
    localStorage.removeItem("orgii-v2-session-view");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens Launchpad in a separate tab and preserves the current session tab", async () => {
    const {
      activateChatPanelTabAtom,
      activeChatPanelSurfaceAtom,
      addChatPanelLaunchpadTabAtom,
      CHAT_PANEL_SURFACE_KIND,
      chatPanelTabsAtom,
      openSessionInNewChatTabAtom,
      store,
    } = await loadChatPanelTabAtoms();

    const sessionTabId = store.set(openSessionInNewChatTabAtom, {
      sessionId: "session-current",
      sessionName: "Current session",
    });
    const launchpadTabId = store.set(addChatPanelLaunchpadTabAtom, "Launchpad");

    expect(store.get(chatPanelTabsAtom)).toMatchObject({
      activeTabId: launchpadTabId,
      tabs: expect.arrayContaining([
        expect.objectContaining({
          id: sessionTabId,
          type: "session",
          sessionId: "session-current",
        }),
        expect.objectContaining({
          id: launchpadTabId,
          type: "launchpad",
          title: "Launchpad",
        }),
      ]),
    });
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(
      CHAT_PANEL_SURFACE_KIND.WORKSPACE_DASHBOARD
    );

    store.set(activateChatPanelTabAtom, sessionTabId);

    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(
      CHAT_PANEL_SURFACE_KIND.SESSION
    );
  });
});

describe("openSessionInNewChatTabAtom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.removeItem("orgii:chatPanelTabs");
    localStorage.removeItem("orgii-v2-session-view");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a linked tab and switches the WorkStation session", async () => {
    const {
      activeSessionIdAtom,
      chatPanelTabsAtom,
      openSessionInNewChatTabAtom,
      sessionViewAtom,
      store,
    } = await loadChatPanelTabAtoms();

    const tabId = store.set(openSessionInNewChatTabAtom, {
      sessionId: "session-target",
      sessionName: "Target session",
      repoPath: "/repos/orgii",
    });

    const tabsState = store.get(chatPanelTabsAtom);
    const sessionView = store.get(sessionViewAtom);

    expect(tabsState.activeTabId).toBe(tabId);
    expect(tabsState.tabs.at(-1)).toMatchObject({
      id: tabId,
      type: "session",
      sessionId: "session-target",
    });
    expect(sessionView).toMatchObject({
      activeSessionId: "session-target",
      sessionName: "Target session",
      repoPath: "/repos/orgii",
    });
    expect(store.get(activeSessionIdAtom)).toBe("session-target");
  });

  it("activates a linked session tab through the shared activation action", async () => {
    const {
      activateChatPanelTabAtom,
      activeSessionIdAtom,
      openSessionInNewChatTabAtom,
      sessionViewAtom,
      sessionsAtom,
      store,
    } = await loadChatPanelTabAtoms();

    store.set(sessionsAtom, [
      makeSession("session-a", {
        name: "Session A",
        repoPath: "/repos/a",
      }),
      makeSession("session-b", {
        name: "Session B",
        repoPath: "/repos/b",
      }),
    ]);
    const firstTabId = store.set(openSessionInNewChatTabAtom, "session-a");
    store.set(openSessionInNewChatTabAtom, "session-b");

    store.set(activateChatPanelTabAtom, firstTabId);

    expect(store.get(activeSessionIdAtom)).toBe("session-a");
    expect(store.get(sessionViewAtom)).toMatchObject({
      activeSessionId: "session-a",
      sessionName: "Session A",
      repoPath: "/repos/a",
    });
  });

  it("uses the shared activation path for previous-tab navigation", async () => {
    const {
      activeSessionIdAtom,
      openSessionInNewChatTabAtom,
      prevChatPanelTabAtom,
      sessionsAtom,
      store,
    } = await loadChatPanelTabAtoms();

    store.set(sessionsAtom, [
      makeSession("session-a", { name: "Session A", repoPath: "/repos/a" }),
      makeSession("session-b", { name: "Session B", repoPath: "/repos/b" }),
    ]);
    store.set(openSessionInNewChatTabAtom, "session-a");
    store.set(openSessionInNewChatTabAtom, "session-b");

    store.set(prevChatPanelTabAtom);

    expect(store.get(activeSessionIdAtom)).toBe("session-a");
  });

  it("uses the shared activation path after closing the active tab", async () => {
    const {
      activeSessionIdAtom,
      closeChatPanelTabAtom,
      openSessionInNewChatTabAtom,
      sessionsAtom,
      store,
    } = await loadChatPanelTabAtoms();

    store.set(sessionsAtom, [
      makeSession("session-a", { name: "Session A", repoPath: "/repos/a" }),
      makeSession("session-b", { name: "Session B", repoPath: "/repos/b" }),
    ]);
    store.set(openSessionInNewChatTabAtom, "session-a");
    const secondTabId = store.set(openSessionInNewChatTabAtom, "session-b");

    store.set(closeChatPanelTabAtom, secondTabId);

    expect(store.get(activeSessionIdAtom)).toBe("session-a");
  });
});
