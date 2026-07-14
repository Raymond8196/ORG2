import { describe, expect, it } from "vitest";

import {
  AGENT_MESSAGE_PREVIEW_MAX_HEIGHT,
  resolveAgentMessageClampEligibility,
} from "../index";

describe("resolveAgentMessageClampEligibility", () => {
  it("clamps non-final rounds", () => {
    expect(resolveAgentMessageClampEligibility(false, false)).toBe(true);
  });

  it("keeps the latest round open even when the host fallback is enabled", () => {
    expect(resolveAgentMessageClampEligibility(true, true)).toBe(false);
  });

  it("uses the host fallback outside a turn context", () => {
    expect(resolveAgentMessageClampEligibility(null, true)).toBe(true);
    expect(resolveAgentMessageClampEligibility(null, false)).toBe(false);
  });
});

describe("agent message preview height", () => {
  it("restores the twenty-line preview depth", () => {
    expect(AGENT_MESSAGE_PREVIEW_MAX_HEIGHT).toBe(20 * 24);
  });
});
