import { describe, expect, it } from "vitest";

import {
  getSettingsDefaults,
  validateSettings,
} from "@src/config/settingsSchema";

describe("sidebar item appearance", () => {
  it("uses the Codex-equivalent selection default", () => {
    expect(getSettingsDefaults()["layout.sidebarSelectedRowOpacity"]).toBe(5);
  });

  it("accepts a user-selected highlight intensity", () => {
    expect(
      validateSettings({ "layout.sidebarSelectedRowOpacity": 12 })[
        "layout.sidebarSelectedRowOpacity"
      ]
    ).toBe(12);
  });

  it("enables the sidebar edge depth by default", () => {
    expect(getSettingsDefaults()["layout.sidebarEdgeDepthEnabled"]).toBe(true);
  });

  it("accepts disabling the sidebar edge depth", () => {
    expect(
      validateSettings({ "layout.sidebarEdgeDepthEnabled": false })[
        "layout.sidebarEdgeDepthEnabled"
      ]
    ).toBe(false);
  });
});
