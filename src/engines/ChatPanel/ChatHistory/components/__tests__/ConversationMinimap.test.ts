import { describe, expect, it } from "vitest";

import {
  findNearestConversationMarker,
  resolveActiveConversationMarker,
  sampleConversationGroupIndices,
} from "../ConversationMinimap";

describe("sampleConversationGroupIndices", () => {
  it("keeps every turn when the conversation fits within the marker cap", () => {
    expect(sampleConversationGroupIndices([1, 2, 4, 7])).toEqual([1, 2, 4, 7]);
  });

  it("samples long conversations by percentage and retains both ends", () => {
    const groupIndices = Array.from({ length: 101 }, (_, index) => index);
    const sampled = sampleConversationGroupIndices(groupIndices, 20);

    expect(sampled).toHaveLength(20);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(100);
    expect(new Set(sampled).size).toBe(20);
    expect(sampled[10]).toBeGreaterThanOrEqual(50);
    expect(sampled[10]).toBeLessThanOrEqual(55);
  });

  it("returns the final turn when only one marker is requested", () => {
    expect(sampleConversationGroupIndices([2, 8, 13], 1)).toEqual([13]);
  });
});

describe("findNearestConversationMarker", () => {
  it("maps an unsampled active turn to its nearest percentage marker", () => {
    expect(findNearestConversationMarker([0, 5, 10, 15], 8)).toBe(10);
  });

  it("returns null when no markers are available", () => {
    expect(findNearestConversationMarker([], 3)).toBeNull();
  });
});

describe("resolveActiveConversationMarker", () => {
  it("selects the final sampled round at the content bottom", () => {
    expect(resolveActiveConversationMarker([0, 5, 10, 15], 10, true)).toBe(15);
  });

  it("uses the nearest sampled round away from the content bottom", () => {
    expect(resolveActiveConversationMarker([0, 5, 10, 15], 8, false)).toBe(10);
  });
});
