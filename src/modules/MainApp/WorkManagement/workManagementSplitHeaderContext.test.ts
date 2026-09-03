import { describe, expect, it } from "vitest";

import { shouldHideWorkManagementHostHeader } from "./workManagementSplitHeaderContext";

describe("Work Management header ownership", () => {
  it("lets a split surface hide the redundant row when the tab bar is visible", () => {
    expect(shouldHideWorkManagementHostHeader(true, true)).toBe(true);
  });

  it("keeps the pane's top header when the tab row is folded away", () => {
    expect(shouldHideWorkManagementHostHeader(false, true)).toBe(false);
  });
});
