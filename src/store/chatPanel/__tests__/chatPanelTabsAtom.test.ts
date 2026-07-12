import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@src/store/session/sessionAtom/types";
import type { KanbanReplayEvent } from "@src/store/ui/kanbanReplayAtom";

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
    kanbanReplayBoundsAtom,
    kanbanReplayCursorAtom,
    kanbanReplayEventsAtom,
    kanbanReplayModeAtom,
    kanbanReplayPlayingAtom,
    kanbanReplaySpeedAtom,
  } = await import("@src/store/ui/kanbanReplayAtom");
  const { kanbanDetailPanelVisibleAtom, kanbanSelectedTaskIdAtom } =
    await import("@src/store/ui/kanbanViewStateAtom");
  const { opsControlCreatorVisibleAtom } =
    await import("@src/store/ui/opsControlCreatorAtom");
  const {
    activateChatPanelTabAtom,
    activeOpsControlHomeTabAtom,
    addChatPanelLaunchpadTabAtom,
    chatPanelTabsAtom,
    closeChatPanelTabAtom,
    normalizePersistedChatPanelTabsState,
    openOpsControlChatPanelTabAtom,
    openOrFocusChatPanelManageTabAtom,
    openOrFocusSessionInChatPanelTabAtom,
    openSessionInNewChatTabAtom,
    prevChatPanelTabAtom,
    syncActiveChatPanelTabStateAtom,
  } = await import("../chatPanelTabsAtom");
  const {
    activeChatPanelSurfaceAtom,
    chatPanelMaximizedAtom,
    chatPanelStartPageOpenAtom,
    chatPanelStartPageTabAtom,
    CHAT_PANEL_SURFACE_KIND,
    CHAT_PANEL_START_PAGE_TAB,
  } = await import("@src/store/ui/chatPanelAtom");
  const {
    OPS_CONTROL_HOME_TAB,
    OPS_CONTROL_PROJECTS_VIEW,
    opsControlProjectsViewAtom,
    workstationTabHeaderAtomByHost,
  } = await import("@src/store/workstation/workstationTabBarAtoms");

  return {
    activateChatPanelTabAtom,
    activeOpsControlHomeTabAtom,
    activeChatPanelSurfaceAtom,
    activeSessionIdAtom,
    addChatPanelLaunchpadTabAtom,
    CHAT_PANEL_SURFACE_KIND,
    chatPanelTabsAtom,
    chatPanelMaximizedAtom,
    chatPanelStartPageOpenAtom,
    chatPanelStartPageTabAtom,
    closeChatPanelTabAtom,
    kanbanDetailPanelVisibleAtom,
    kanbanReplayBoundsAtom,
    kanbanReplayCursorAtom,
    kanbanReplayEventsAtom,
    kanbanReplayModeAtom,
    kanbanReplayPlayingAtom,
    kanbanReplaySpeedAtom,
    kanbanSelectedTaskIdAtom,
    normalizePersistedChatPanelTabsState,
    openOpsControlChatPanelTabAtom,
    openOrFocusChatPanelManageTabAtom,
    openOrFocusSessionInChatPanelTabAtom,
    OPS_CONTROL_HOME_TAB,
    OPS_CONTROL_PROJECTS_VIEW,
    opsControlCreatorVisibleAtom,
    opsControlProjectsViewAtom,
    openSessionInNewChatTabAtom,
    prevChatPanelTabAtom,
    syncActiveChatPanelTabStateAtom,
    sessionViewAtom,
    sessionsAtom,
    store,
    CHAT_PANEL_START_PAGE_TAB,
    workstationTabHeaderAtomByHost,
  };
}

describe("closeChatPanelTabAtom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a Launchpad fallback when the last tab closes", async () => {
    const {
      activeChatPanelSurfaceAtom,
      CHAT_PANEL_SURFACE_KIND,
      chatPanelTabsAtom,
      chatPanelStartPageOpenAtom,
      closeChatPanelTabAtom,
      store,
    } = await loadChatPanelTabAtoms();
    const initialTabId = store.get(chatPanelTabsAtom).activeTabId;
    expect(store.get(chatPanelTabsAtom).tabs[0]).toMatchObject({
      id: initialTabId,
      type: "start-page",
      title: "Launchpad",
    });

    store.set(closeChatPanelTabAtom, initialTabId);

    const fallbackState = store.get(chatPanelTabsAtom);
    expect(fallbackState.tabs).toEqual([
      expect.objectContaining({
        id: fallbackState.activeTabId,
        type: "start-page",
        title: "Launchpad",
      }),
    ]);
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(
      CHAT_PANEL_SURFACE_KIND.SESSION
    );
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(true);

    store.set(closeChatPanelTabAtom, fallbackState.activeTabId);
    expect(store.get(chatPanelTabsAtom).tabs).toHaveLength(1);
    expect(store.get(chatPanelTabsAtom).tabs[0].type).toBe("start-page");
  });

  it("restores docked presentation when the final management tab closes", async () => {
    const {
      chatPanelMaximizedAtom,
      chatPanelTabsAtom,
      closeChatPanelTabAtom,
      openOpsControlChatPanelTabAtom,
      store,
    } = await loadChatPanelTabAtoms();
    const initialTabId = store.get(chatPanelTabsAtom).activeTabId;
    const managementTabId = store.set(openOpsControlChatPanelTabAtom, {});

    store.set(closeChatPanelTabAtom, initialTabId);
    store.set(closeChatPanelTabAtom, managementTabId);

    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(store.get(chatPanelTabsAtom).tabs[0].type).toBe("start-page");
  });

  it("releases transient Ops Control state when its tab closes", async () => {
    const {
      chatPanelTabsAtom,
      closeChatPanelTabAtom,
      kanbanDetailPanelVisibleAtom,
      kanbanReplayBoundsAtom,
      kanbanReplayCursorAtom,
      kanbanReplayEventsAtom,
      kanbanReplayModeAtom,
      kanbanReplayPlayingAtom,
      kanbanReplaySpeedAtom,
      kanbanSelectedTaskIdAtom,
      openOpsControlChatPanelTabAtom,
      OPS_CONTROL_PROJECTS_VIEW,
      opsControlCreatorVisibleAtom,
      opsControlProjectsViewAtom,
      store,
      workstationTabHeaderAtomByHost,
    } = await loadChatPanelTabAtoms();
    const opsControlTabId = store.set(openOpsControlChatPanelTabAtom, {});
    const retainedEvents = [
      { id: "session-1:created", ts: 1, kind: "created", task: {} },
    ] as unknown as KanbanReplayEvent[];

    store.set(opsControlCreatorVisibleAtom, true);
    store.set(opsControlProjectsViewAtom, OPS_CONTROL_PROJECTS_VIEW.PROJECTS);
    store.set(kanbanSelectedTaskIdAtom, "session-1");
    store.set(kanbanDetailPanelVisibleAtom, true);
    store.set(kanbanReplayCursorAtom, 100);
    store.set(kanbanReplayModeAtom, "replay");
    store.set(kanbanReplayBoundsAtom, { start: 1, end: 100 });
    store.set(kanbanReplayEventsAtom, retainedEvents);
    store.set(kanbanReplayPlayingAtom, true);
    store.set(kanbanReplaySpeedAtom, 4);
    store.set(workstationTabHeaderAtomByHost.opsControl, {
      trailing: "retained header",
    });

    store.set(closeChatPanelTabAtom, opsControlTabId);

    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.some((tab) => tab.type === "ops-control")
    ).toBe(false);
    expect(store.get(opsControlCreatorVisibleAtom)).toBe(false);
    expect(store.get(opsControlProjectsViewAtom)).toBe(
      OPS_CONTROL_PROJECTS_VIEW.WORK_ITEMS
    );
    expect(store.get(kanbanSelectedTaskIdAtom)).toBeNull();
    expect(store.get(kanbanDetailPanelVisibleAtom)).toBe(false);
    expect(store.get(kanbanReplayCursorAtom)).toBeNull();
    expect(store.get(kanbanReplayModeAtom)).toBe("follow");
    expect(store.get(kanbanReplayBoundsAtom)).toEqual({ start: 0, end: 0 });
    expect(store.get(kanbanReplayEventsAtom)).toEqual([]);
    expect(store.get(kanbanReplayPlayingAtom)).toBe(false);
    expect(store.get(kanbanReplaySpeedAtom)).toBe(1);
    expect(store.get(workstationTabHeaderAtomByHost.opsControl)).toBeNull();
  });
});

describe("openOpsControlChatPanelTabAtom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens Kanban as a singleton default-fullscreen management tab", async () => {
    const {
      chatPanelMaximizedAtom,
      chatPanelTabsAtom,
      activeOpsControlHomeTabAtom,
      openOpsControlChatPanelTabAtom,
      OPS_CONTROL_HOME_TAB,
      store,
    } = await loadChatPanelTabAtoms();

    const firstId = store.set(openOpsControlChatPanelTabAtom, {});
    const secondId = store.set(openOpsControlChatPanelTabAtom, {});

    expect(secondId).toBe(firstId);
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.filter((tab) => tab.type === "ops-control")
    ).toHaveLength(1);
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
    expect(store.get(activeOpsControlHomeTabAtom)).toBe(
      OPS_CONTROL_HOME_TAB.OPS_CONTROL
    );
  });

  it("keeps a manual Workstation restore while Ops Control remains active", async () => {
    const {
      chatPanelMaximizedAtom,
      openOpsControlChatPanelTabAtom,
      store,
      syncActiveChatPanelTabStateAtom,
    } = await loadChatPanelTabAtoms();

    store.set(openOpsControlChatPanelTabAtom, {});
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);

    store.set(chatPanelMaximizedAtom, false);
    store.set(syncActiveChatPanelTabStateAtom);

    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
  });

  it("preserves a manual Workstation restore after leaving Ops Control", async () => {
    const {
      activateChatPanelTabAtom,
      chatPanelMaximizedAtom,
      chatPanelTabsAtom,
      openOpsControlChatPanelTabAtom,
      store,
    } = await loadChatPanelTabAtoms();
    const primaryTabId = store.get(chatPanelTabsAtom).activeTabId;

    store.set(chatPanelMaximizedAtom, true);
    store.set(openOpsControlChatPanelTabAtom, {});
    store.set(chatPanelMaximizedAtom, false);
    store.set(activateChatPanelTabAtom, primaryTabId);

    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
  });

  it("keeps management tab, surface header, and sidebar selection correlated", async () => {
    const {
      activateChatPanelTabAtom,
      activeChatPanelSurfaceAtom,
      activeOpsControlHomeTabAtom,
      addChatPanelLaunchpadTabAtom,
      CHAT_PANEL_SURFACE_KIND,
      chatPanelStartPageOpenAtom,
      chatPanelTabsAtom,
      openOpsControlChatPanelTabAtom,
      OPS_CONTROL_HOME_TAB,
      store,
    } = await loadChatPanelTabAtoms();

    store.set(addChatPanelLaunchpadTabAtom, "Launchpad");
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(true);

    const opsControlTabId = store.set(openOpsControlChatPanelTabAtom, {});
    expect(store.get(chatPanelTabsAtom)).toMatchObject({
      activeTabId: opsControlTabId,
      tabs: expect.arrayContaining([
        expect.objectContaining({
          id: opsControlTabId,
          type: "ops-control",
          title: "Kanban",
        }),
      ]),
    });
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(false);
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(
      CHAT_PANEL_SURFACE_KIND.SESSION
    );
    expect(store.get(activeOpsControlHomeTabAtom)).toBe(
      OPS_CONTROL_HOME_TAB.OPS_CONTROL
    );

    const projectsTabId = store.set(openOpsControlChatPanelTabAtom, {
      section: OPS_CONTROL_HOME_TAB.PROJECTS,
    });
    expect(projectsTabId).toBe(opsControlTabId);
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.filter((tab) => tab.type === "ops-control")
    ).toHaveLength(1);
    expect(store.get(activeOpsControlHomeTabAtom)).toBe(
      OPS_CONTROL_HOME_TAB.PROJECTS
    );
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.find((tab) => tab.id === opsControlTabId)?.title
    ).toBe("Projects");

    store.set(openOpsControlChatPanelTabAtom, {
      section: OPS_CONTROL_HOME_TAB.GITHUB_ISSUES,
    });
    expect(store.get(activeOpsControlHomeTabAtom)).toBe(
      OPS_CONTROL_HOME_TAB.GITHUB_ISSUES
    );
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.find((tab) => tab.id === opsControlTabId)?.title
    ).toBe("GitHub Issues");

    store.set(openOpsControlChatPanelTabAtom, {
      section: OPS_CONTROL_HOME_TAB.GITHUB_PRS,
    });
    expect(store.get(activeOpsControlHomeTabAtom)).toBe(
      OPS_CONTROL_HOME_TAB.GITHUB_PRS
    );
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.find((tab) => tab.id === opsControlTabId)?.title
    ).toBe("GitHub PRs");

    store.set(activateChatPanelTabAtom, opsControlTabId);
    expect(store.get(activeOpsControlHomeTabAtom)).toBe(
      OPS_CONTROL_HOME_TAB.GITHUB_PRS
    );
  });

  it("restores the prior docked state after leaving a management tab", async () => {
    const {
      activateChatPanelTabAtom,
      chatPanelMaximizedAtom,
      chatPanelTabsAtom,
      openOpsControlChatPanelTabAtom,
      OPS_CONTROL_HOME_TAB,
      store,
    } = await loadChatPanelTabAtoms();
    const primaryTabId = store.get(chatPanelTabsAtom).activeTabId;

    store.set(openOpsControlChatPanelTabAtom, {
      section: OPS_CONTROL_HOME_TAB.PROJECTS,
    });
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);

    store.set(activateChatPanelTabAtom, primaryTabId);

    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
  });
});

describe("ChatPanel navigation tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.removeItem("orgii:chatPanelTabs");
    localStorage.removeItem("orgii-v2-session-view");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the three-section Launchpad in a separate tab", async () => {
    const {
      activeChatPanelSurfaceAtom,
      addChatPanelLaunchpadTabAtom,
      CHAT_PANEL_SURFACE_KIND,
      chatPanelTabsAtom,
      chatPanelStartPageOpenAtom,
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
          type: "start-page",
          title: "Launchpad",
        }),
      ]),
    });
    expect(store.get(activeChatPanelSurfaceAtom).kind).toBe(
      CHAT_PANEL_SURFACE_KIND.SESSION
    );
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(true);
  });

  it("opens or focuses a session tab when selected from Launchpad", async () => {
    const {
      addChatPanelLaunchpadTabAtom,
      chatPanelStartPageOpenAtom,
      chatPanelTabsAtom,
      openOrFocusSessionInChatPanelTabAtom,
      store,
    } = await loadChatPanelTabAtoms();

    store.set(addChatPanelLaunchpadTabAtom, "Launchpad");
    const sessionTabId = store.set(openOrFocusSessionInChatPanelTabAtom, {
      sessionId: "sidebar-session",
      sessionName: "Sidebar session",
      repoPath: "/tmp/sidebar-session",
    });

    expect(store.get(chatPanelTabsAtom)).toMatchObject({
      activeTabId: sessionTabId,
      tabs: expect.arrayContaining([
        expect.objectContaining({
          id: sessionTabId,
          type: "session",
          sessionId: "sidebar-session",
          title: "Sidebar session",
        }),
      ]),
    });
    expect(store.get(chatPanelStartPageOpenAtom)).toBe(false);

    const focusedTabId = store.set(openOrFocusSessionInChatPanelTabAtom, {
      sessionId: "sidebar-session",
      sessionName: "Sidebar session",
      repoPath: "/tmp/sidebar-session",
    });
    expect(focusedTabId).toBe(sessionTabId);
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.filter((tab) => tab.sessionId === "sidebar-session")
    ).toHaveLength(1);
  });

  it("focuses Launchpad Manage without creating a duplicate tab", async () => {
    const {
      chatPanelStartPageTabAtom,
      chatPanelTabsAtom,
      openOrFocusChatPanelManageTabAtom,
      CHAT_PANEL_START_PAGE_TAB,
      store,
    } = await loadChatPanelTabAtoms();
    const launchpadTabId = store.get(chatPanelTabsAtom).activeTabId;

    const focusedTabId = store.set(openOrFocusChatPanelManageTabAtom);

    expect(focusedTabId).toBe(launchpadTabId);
    expect(store.get(chatPanelTabsAtom).activeTabId).toBe(launchpadTabId);
    expect(store.get(chatPanelStartPageTabAtom)).toBe(
      CHAT_PANEL_START_PAGE_TAB.MANAGE
    );
    expect(
      store
        .get(chatPanelTabsAtom)
        .tabs.filter((tab) => tab.type === "start-page")
    ).toHaveLength(1);
  });

  it("migrates persisted legacy Launchpad tabs to the start page", async () => {
    const { normalizePersistedChatPanelTabsState } =
      await loadChatPanelTabAtoms();

    expect(
      normalizePersistedChatPanelTabsState({
        activeTabId: "legacy-launchpad",
        tabs: [
          {
            id: "legacy-launchpad",
            type: "launchpad",
            title: "Launchpad",
            createdAt: "2026-07-12T00:00:00.000Z",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        ],
      })
    ).toMatchObject({
      activeTabId: "legacy-launchpad",
      tabs: [
        expect.objectContaining({
          id: "legacy-launchpad",
          type: "start-page",
          title: "Launchpad",
        }),
      ],
    });
  });

  it("consolidates persisted Dashboard tabs into Launchpad", async () => {
    const { normalizePersistedChatPanelTabsState } =
      await loadChatPanelTabAtoms();

    expect(
      normalizePersistedChatPanelTabsState({
        activeTabId: "dashboard",
        tabs: [{ id: "dashboard", type: "dashboard", title: "Dashboard" }],
      })
    ).toMatchObject({
      activeTabId: "dashboard",
      tabs: [
        expect.objectContaining({
          id: "dashboard",
          type: "start-page",
          title: "Launchpad",
        }),
      ],
    });
  });

  it("migrates empty conversation tabs to Launchpad", async () => {
    const { normalizePersistedChatPanelTabsState } =
      await loadChatPanelTabAtoms();

    expect(
      normalizePersistedChatPanelTabsState({
        activeTabId: "empty-chat",
        tabs: [
          {
            id: "empty-chat",
            type: "session",
            title: "Chat",
            sessionId: null,
          },
        ],
      })
    ).toMatchObject({
      activeTabId: "empty-chat",
      tabs: [
        expect.objectContaining({
          id: "empty-chat",
          type: "start-page",
          title: "Launchpad",
        }),
      ],
    });
  });

  it("merges legacy Projects and Ops Control tabs into one Ops Control tab", async () => {
    const { normalizePersistedChatPanelTabsState, OPS_CONTROL_HOME_TAB } =
      await loadChatPanelTabAtoms();

    expect(
      normalizePersistedChatPanelTabsState({
        activeTabId: "legacy-projects",
        tabs: [
          {
            id: "ops-control",
            type: "ops-control",
            title: "Ops Control",
          },
          {
            id: "legacy-projects",
            type: "ops-projects",
            title: "Projects",
          },
        ],
      })
    ).toEqual({
      activeTabId: "legacy-projects",
      tabs: [
        expect.objectContaining({
          id: "legacy-projects",
          type: "ops-control",
          title: "Projects",
          opsSection: OPS_CONTROL_HOME_TAB.PROJECTS,
        }),
      ],
    });
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
