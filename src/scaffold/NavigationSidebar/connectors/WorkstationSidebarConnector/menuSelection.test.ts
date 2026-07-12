import { describe, expect, it } from "vitest";

import { COLLAB_ADD_ORG_MENU_ITEM_ID } from "@src/scaffold/NavigationSidebar/connectors/sidebarConnectorUtils";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  CHAT_PANEL_START_PAGE_TAB,
  type ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

import { buildColleaguesSidebarMenuItems } from "./colleaguesSidebarMenuItems";
import {
  FOLDERS_DASHBOARD_ITEM_ID,
  FOLDERS_EXPLORE_ITEM_ID,
} from "./foldersSidebarMenuItems";
import { resolveSelectedMenuItemIds } from "./menuSelection";

function resolveFoldersSelection(overrides: {
  activeChatPanelTabType?: "start-page" | null;
  chatPanelExploreOpen?: boolean;
  manageTabActive?: boolean;
  chatPanelSelectedWorkspace?: ChatPanelSelectedWorkspace | null;
}): string {
  return resolveSelectedMenuItemIds({
    activeSessionCreatorDraftId: null,
    activeSessionId: "session-1",
    activeSidebarKey: "folders",
    activeChatPanelTabType: overrides.activeChatPanelTabType ?? null,
    chatPanelContentMode: CHAT_PANEL_CONTENT_MODE.NON_SESSION,
    chatPanelCreateTarget: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
    chatPanelSelectedProject: null,
    chatPanelSelectedWorkItem: null,
    chatPanelSelectedWorkspace: overrides.chatPanelSelectedWorkspace ?? null,
    chatPanelStartPageTab: overrides.manageTabActive
      ? CHAT_PANEL_START_PAGE_TAB.MANAGE
      : CHAT_PANEL_START_PAGE_TAB.WORK,
    chatPanelExploreOpen: overrides.chatPanelExploreOpen ?? false,
    opsControlRoutePath: "/ops-control",
    pathname: "/workstation/code",
    projectsSelectedMenuItemId: "",
    sessionCreatorDrafts: [],
  }).selectedMenuItemId;
}

describe("resolveSelectedMenuItemIds", () => {
  it("selects Ops Control from the active ChatPanel tab without the legacy route", () => {
    expect(
      resolveSelectedMenuItemIds({
        activeSessionCreatorDraftId: null,
        activeSessionId: "session-1",
        activeSidebarKey: "workstation",
        activeChatPanelTabType: "ops-control",
        chatPanelContentMode: CHAT_PANEL_CONTENT_MODE.SESSION,
        chatPanelCreateTarget: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
        chatPanelSelectedProject: null,
        chatPanelSelectedWorkItem: null,
        chatPanelSelectedWorkspace: null,
        chatPanelStartPageTab: CHAT_PANEL_START_PAGE_TAB.WORK,
        chatPanelExploreOpen: false,
        opsControlRoutePath: "/ops-control",
        pathname: "/workstation/code",
        projectsSelectedMenuItemId: "",
        sessionCreatorDrafts: [],
      }).selectedMenuItemId
    ).toBe("ops-control");
  });

  it("selects Explore from the active ChatPanel surface state", () => {
    expect(resolveFoldersSelection({ chatPanelExploreOpen: true })).toBe(
      FOLDERS_EXPLORE_ITEM_ID
    );
  });

  it("selects Dashboard when Launchpad Manage is active", () => {
    expect(
      resolveFoldersSelection({
        activeChatPanelTabType: "start-page",
        manageTabActive: true,
      })
    ).toBe(FOLDERS_DASHBOARD_ITEM_ID);
  });

  it("prefers workspace selection over stale Explore or Manage state", () => {
    const workspace = {
      kind: "repo",
      id: "repo-1",
      name: "Repo",
    } satisfies ChatPanelSelectedWorkspace;

    expect(
      resolveFoldersSelection({
        chatPanelExploreOpen: true,
        activeChatPanelTabType: "start-page",
        manageTabActive: true,
        chatPanelSelectedWorkspace: workspace,
      })
    ).toBe("folders-repo:repo-1");
  });

  it("selects Add Org by default on the projects sidebar for the collab org create target", () => {
    expect(
      resolveSelectedMenuItemIds({
        activeSessionCreatorDraftId: null,
        activeSessionId: "session-1",
        activeSidebarKey: "projects",
        activeChatPanelTabType: null,
        chatPanelContentMode: CHAT_PANEL_CONTENT_MODE.NON_SESSION,
        chatPanelCreateTarget: CHAT_PANEL_CREATE_TARGET.COLLAB_ORG,
        chatPanelSelectedProject: null,
        chatPanelSelectedWorkItem: null,
        chatPanelSelectedWorkspace: null,
        chatPanelStartPageTab: CHAT_PANEL_START_PAGE_TAB.WORK,
        chatPanelExploreOpen: false,
        opsControlRoutePath: "/ops-control",
        pathname: "/workstation/code",
        projectsSelectedMenuItemId: "",
        sessionCreatorDrafts: [],
      }).selectedMenuItemId
    ).toBe(COLLAB_ADD_ORG_MENU_ITEM_ID);
  });
});

describe("buildColleaguesSidebarMenuItems", () => {
  it("groups colleagues by org with dashboard and member rows", () => {
    const items = buildColleaguesSidebarMenuItems({
      orgs: [
        {
          id: "org-1",
          name: "Team",
          createdAt: "2026-06-15T00:00:00.000Z",
        },
      ],
      members: [
        {
          id: "member-1",
          orgId: "org-1",
          displayName: "Build Agent",
          avatar: { initials: "BA", variant: "v" },
          role: "member",
          identityKind: "agent",
          joinedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
      remoteSessions: [
        {
          id: "remote-1",
          orgId: "org-1",
          ownerMemberId: "member-1",
          ownerUserId: "member-1",
          ownerDisplayName: "Build Agent",
          ownerIdentityKind: "agent",
          sourceSessionId: "session-1",
          title: "Refactor sidebar",
          status: "running",
        },
      ],
      searchQuery: "agent",
      dashboardLabel: "Dashboard",
      unknownOrgLabel: "Unknown org",
    });

    expect(items[0]?.id).toBe("separator-colleagues-org-section:org-1");
    expect(items[1]?.label).toBe("Dashboard");
    expect(items[2]?.shortcut).toBe("agent");
  });
});
