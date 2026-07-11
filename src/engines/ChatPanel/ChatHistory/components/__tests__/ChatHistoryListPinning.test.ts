import { describe, expect, it } from "vitest";

import { resolveActiveGroupPinState } from "../ChatHistoryList";

describe("resolveActiveGroupPinState", () => {
  it("pins as soon as the active turn crosses the top", () => {
    expect(resolveActiveGroupPinState([{ groupIndex: 0, top: -1 }])).toEqual({
      groupIndex: 0,
      pinned: true,
    });
  });

  it("does not pin before the first turn crosses the top", () => {
    expect(resolveActiveGroupPinState([{ groupIndex: 0, top: 1 }])).toEqual({
      groupIndex: 0,
      pinned: false,
    });
  });

  it("switches the pin to the latest turn that crossed the top", () => {
    expect(
      resolveActiveGroupPinState([
        { groupIndex: 0, top: -600 },
        { groupIndex: 1, top: -10 },
      ])
    ).toEqual({ groupIndex: 1, pinned: true });
  });
});
