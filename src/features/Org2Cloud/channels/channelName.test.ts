import { describe, expect, it } from "vitest";

import {
  normalizeChannelName,
  normalizeChannelNameInput,
  validateChannelName,
} from "./channelName";
import { CHANNEL_NAME_MAX_LENGTH } from "./types";

describe("channel name normalization", () => {
  it("lowercases, strips leading #, and hyphenates whitespace while typing", () => {
    expect(normalizeChannelNameInput("#Launch Swarm")).toBe("launch-swarm");
    expect(normalizeChannelNameInput("##General")).toBe("general");
    expect(normalizeChannelNameInput("a  b\tc")).toBe("a-b-c");
  });

  it("caps live input at the server bound", () => {
    const raw = "x".repeat(CHANNEL_NAME_MAX_LENGTH + 20);
    expect(normalizeChannelNameInput(raw)).toHaveLength(
      CHANNEL_NAME_MAX_LENGTH
    );
  });

  it("drops edge hyphens left by typing on submit", () => {
    expect(normalizeChannelName("  flight path  ")).toBe("flight-path");
    expect(normalizeChannelName("-queen-bee-")).toBe("queen-bee");
  });

  it("keeps non-latin names intact (unicode channel names are allowed)", () => {
    expect(normalizeChannelName("产品讨论")).toBe("产品讨论");
  });

  it("validates the normalized form against the 0014 contract", () => {
    expect(validateChannelName("")).toBe("empty");
    expect(validateChannelName("x".repeat(CHANNEL_NAME_MAX_LENGTH + 1))).toBe(
      "tooLong"
    );
    expect(validateChannelName("has space")).toBe("whitespace");
    expect(validateChannelName("flight-path")).toBeNull();
  });
});
