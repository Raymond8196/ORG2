import { describe, expect, it } from "vitest";

import {
  OPS_CONTROL_HOME_TAB,
  OPS_CONTROL_PROJECTS_VIEW,
} from "@src/store/workstation";

import {
  OPS_CONTROL_GITHUB_ISSUES_MENU_ITEM_ID,
  OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID,
  OPS_CONTROL_KANBAN_MENU_ITEM_ID,
  OPS_CONTROL_MENU_ITEM_ID,
  OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
} from "../sidebarConnectorUtils";
import {
  buildOpsControlSidebarMenuItems,
  resolveOpsControlSidebarMenuItemId,
} from "./opsControlSidebarMenuItems";

describe("buildOpsControlSidebarMenuItems", () => {
  it("builds the expandable Work Items destinations", () => {
    const items = buildOpsControlSidebarMenuItems({
      projects: "Projects",
      githubIssues: "GitHub Issues",
      githubPrs: "GitHub PRs",
    });

    expect(items.map((item) => item.id)).toEqual([
      OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
      OPS_CONTROL_GITHUB_ISSUES_MENU_ITEM_ID,
      OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID,
    ]);
  });

  it("selects the active expanded child from canonical Ops state", () => {
    expect(
      resolveOpsControlSidebarMenuItemId({
        homeTab: OPS_CONTROL_HOME_TAB.PROJECTS,
        projectsView: OPS_CONTROL_PROJECTS_VIEW.WORK_ITEMS,
      })
    ).toBe(OPS_CONTROL_MENU_ITEM_ID);
    expect(
      resolveOpsControlSidebarMenuItemId({
        homeTab: OPS_CONTROL_HOME_TAB.GITHUB_PRS,
        projectsView: OPS_CONTROL_PROJECTS_VIEW.PROJECTS,
      })
    ).toBe(OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID);
    expect(
      resolveOpsControlSidebarMenuItemId({
        homeTab: OPS_CONTROL_HOME_TAB.OPS_CONTROL,
        projectsView: OPS_CONTROL_PROJECTS_VIEW.WORK_ITEMS,
      })
    ).toBe(OPS_CONTROL_KANBAN_MENU_ITEM_ID);
  });
});
