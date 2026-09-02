import { describe, expect, it } from "vitest";

import {
  applyFloatingHorizontalFrame,
  insetFloatingHorizontalFrame,
} from "./floatingPlacement";

describe("insetFloatingHorizontalFrame", () => {
  it("centers a menu within equal 24px composer side insets", () => {
    expect(
      insetFloatingHorizontalFrame({ left: 80, width: 1600, inset: 24 })
    ).toEqual({ left: 104, width: 1552 });
  });

  it("clamps the inset when a frame is too narrow", () => {
    expect(
      insetFloatingHorizontalFrame({ left: 12, width: 32, inset: 24 })
    ).toEqual({ left: 28, width: 0 });
  });
});

describe("applyFloatingHorizontalFrame", () => {
  it("preserves prototype-backed DOMRect vertical coordinates", () => {
    const anchorRect = Object.create({ top: 120, bottom: 180, left: 80 });

    expect(
      applyFloatingHorizontalFrame(anchorRect, { left: 104, width: 1552 })
    ).toEqual({ top: 120, bottom: 180, left: 104 });
  });
});
