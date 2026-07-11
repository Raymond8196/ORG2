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
});
