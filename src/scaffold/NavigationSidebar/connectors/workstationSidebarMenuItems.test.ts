import { describe, expect, it } from "vitest";

import {
  OPS_CONTROL_KANBAN_MENU_ITEM_ID,
  OPS_CONTROL_MENU_ITEM_ID,
  OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
} from "./sidebarConnectorUtils";
import { buildPinnedMenuItems } from "./workstationSidebarMenuItems";

describe("buildPinnedMenuItems", () => {
  it("renders Kanban separately from the expandable Work Items group", () => {
    const items = buildPinnedMenuItems({
      newSessionLabel: "New Session",
      newSessionShortcut: "⌘N",
      opsControlLabel: "Work Items",
      opsControlItems: [
        {
          id: OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
          key: OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
          label: "Projects",
        },
      ],
      kanbanLabel: "Kanban",
      kanbanShortcut: "⌘O",
    });

    expect(items.map((item) => item.id)).toEqual([
      "new-session",
      OPS_CONTROL_KANBAN_MENU_ITEM_ID,
      OPS_CONTROL_MENU_ITEM_ID,
    ]);
    expect(items[2]?.children?.map((item) => item.id)).toEqual([
      OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
    ]);
    expect(items[2]?.routePath).toBeUndefined();
  });
});
