// @vitest-environment node
import { describe, expect, it } from "vitest";

import { getPortalTransform } from "./positioning";

describe("getPortalTransform", () => {
  // Portal-mode coordinates anchor `left*` panels at the trigger's left edge,
  // so every left placement must shift the panel by its own width — otherwise
  // it renders over the trigger instead of beside it (regression: the
  // workstation trail's environment dropdown was invisible/overlapping).
  it("shifts left placements fully to the left of the anchor", () => {
    expect(getPortalTransform("left")).toBe("translate(-100%, -50%)");
    expect(getPortalTransform("left-start")).toBe("translateX(-100%)");
    expect(getPortalTransform("left-end")).toBe("translate(-100%, -100%)");
  });

  it("keeps right placements anchored at the trigger's right edge", () => {
    expect(getPortalTransform("right")).toBe("translateY(-50%)");
    expect(getPortalTransform("right-start")).toBeUndefined();
    expect(getPortalTransform("right-end")).toBe("translateY(-100%)");
  });
});
