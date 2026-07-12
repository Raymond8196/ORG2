import { describe, expect, it } from "vitest";

import {
  OPS_CONTROL_MENU_ITEM_ID,
  WORKSPACES_SIDEBAR_MENU_ITEM_ID,
  WORK_ITEMS_SIDEBAR_MENU_ITEM_ID,
} from "./sidebarConnectorUtils";
import { buildPinnedMenuItems } from "./workstationSidebarMenuItems";

describe("buildPinnedMenuItems", () => {
  it("places workspace drill-downs directly below Ops Control", () => {
    const items = buildPinnedMenuItems({
      newSessionLabel: "New Session",
      newSessionShortcut: "⌘N",
      opsControlLabel: "Ops Control",
      opsControlRoutePath: "/ops-control",
      opsControlShortcut: "⌘O",
      workspacesLabel: "Workspaces",
      workItemsLabel: "Work Items",
    });

    expect(items.map((item) => item.id)).toEqual([
      "new-session",
      OPS_CONTROL_MENU_ITEM_ID,
      WORKSPACES_SIDEBAR_MENU_ITEM_ID,
      WORK_ITEMS_SIDEBAR_MENU_ITEM_ID,
    ]);
    expect(items[2]?.showDrillDownIndicator).toBe(true);
    expect(items[3]?.showDrillDownIndicator).toBe(true);
  });
});
