import { describe, expect, it } from "vitest";

import { resolveAgentMessageContent } from "../agentMessageContent";

describe("resolveAgentMessageContent", () => {
  it("keeps history text intact while projecting a Canvas creation request", () => {
    const displayText =
      "canvas [skill:/canvas] build a settings page with two tabs";

    const agentContent = resolveAgentMessageContent({
      displayText,
      agentBase: "/canvas build a settings page with two tabs",
      hasTransformedPills: true,
      contextBlocks: [],
      enableAgentInterceptors: true,
    });

    expect(displayText).toBe(
      "canvas [skill:/canvas] build a settings page with two tabs"
    );
    expect(agentContent).toContain("render_inline_canvas exactly once");
    expect(agentContent).toContain("build a settings page with two tabs");
    expect(agentContent).not.toContain("[skill:/canvas]");
  });

  it("appends context after the resolved Canvas contract", () => {
    const agentContent = resolveAgentMessageContent({
      displayText: "canvas [skill:/canvas] use this terminal output",
      agentBase: "/canvas use this terminal output",
      hasTransformedPills: true,
      contextBlocks: ["```\nserver ready\n```"],
      enableAgentInterceptors: true,
    });

    expect(agentContent).toMatch(
      /\[Canvas Creation Request\][\s\S]+\[User Request\][\s\S]+```\nserver ready\n```/
    );
  });

  it("does not intercept messages when the owning composer opts out", () => {
    expect(
      resolveAgentMessageContent({
        displayText: "/canvas build a timer",
        agentBase: "/canvas build a timer",
        hasTransformedPills: false,
        contextBlocks: [],
        enableAgentInterceptors: false,
      })
    ).toBeUndefined();
  });
});
