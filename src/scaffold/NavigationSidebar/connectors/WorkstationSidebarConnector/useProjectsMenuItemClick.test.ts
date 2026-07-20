import { describe, expect, it, vi } from "vitest";

import {
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelNavigateCommand,
} from "@src/store/ui/chatPanelAtom";

import { PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID } from "../sidebarConnectorUtils";
import { openNewWorkItemFromSidebar } from "./useProjectsMenuItemClick";

describe("openNewWorkItemFromSidebar", () => {
  it("opens the shared work-item creator from a sidebar action", () => {
    const calls: string[] = [];
    const resetWorkManagementStateForProjectsContent = vi.fn(() =>
      calls.push("reset")
    );
    const setProjectsSelectedMenuItemId = vi.fn(() => calls.push("select"));
    const navigateChatPanel = vi.fn((_command: ChatPanelNavigateCommand) =>
      calls.push("navigate")
    );

    openNewWorkItemFromSidebar({
      navigateChatPanel,
      resetWorkManagementStateForProjectsContent,
      setProjectsSelectedMenuItemId,
    });

    expect(setProjectsSelectedMenuItemId).toHaveBeenCalledWith(
      PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID
    );
    expect(navigateChatPanel).toHaveBeenCalledWith({
      kind: CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM,
    });
    expect(calls).toEqual(["reset", "select", "navigate"]);
  });
});
