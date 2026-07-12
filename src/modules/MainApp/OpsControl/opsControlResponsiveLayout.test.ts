import { describe, expect, it } from "vitest";

import {
  OPS_CONTROL_MIN_MAIN_CONTENT_WIDTH_PX,
  shouldAutoCollapseOpsControlSidebar,
} from "./opsControlResponsiveLayout";

describe("Ops Control responsive layout", () => {
  it("collapses when the sidebar would leave too little main content", () => {
    expect(
      shouldAutoCollapseOpsControlSidebar({
        surfaceWidth: 580,
        sidebarWidth: 240,
      })
    ).toBe(true);
  });

  it("keeps the sidebar when the remaining main content meets the minimum", () => {
    expect(
      shouldAutoCollapseOpsControlSidebar({
        surfaceWidth: 240 + OPS_CONTROL_MIN_MAIN_CONTENT_WIDTH_PX,
        sidebarWidth: 240,
      })
    ).toBe(false);
  });

  it("ignores an unmeasured surface", () => {
    expect(
      shouldAutoCollapseOpsControlSidebar({
        surfaceWidth: 0,
        sidebarWidth: 240,
      })
    ).toBe(false);
  });
});
