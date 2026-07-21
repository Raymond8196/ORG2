import { describe, expect, it, vi } from "vitest";

import { PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID } from "../sidebarConnectorUtils";
import { openNewWorkItemFromSidebar } from "./useProjectsMenuItemClick";

describe("openNewWorkItemFromSidebar", () => {
  it("opens the shared work-item creator from a sidebar action", () => {
    const calls: string[] = [];
    const resetWorkManagementStateForProjectsContent = vi.fn(() =>
      calls.push("reset")
    );
    const setProjectsSelectedMenuItemId = vi.fn(() => calls.push("select"));
    const openWorkItemCreator = vi.fn(() =>
      calls.push("open-work-item-creator")
    );

    openNewWorkItemFromSidebar({
      openWorkItemCreator,
      resetWorkManagementStateForProjectsContent,
      setProjectsSelectedMenuItemId,
    });

    expect(setProjectsSelectedMenuItemId).toHaveBeenCalledWith(
      PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID
    );
    expect(openWorkItemCreator).toHaveBeenCalledOnce();
    expect(calls).toEqual(["reset", "select", "open-work-item-creator"]);
  });
});
