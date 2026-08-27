import { describe, expect, it } from "vitest";

import { resolveParentAgentSenderSessionId } from "../parentAgentSender";

describe("parent-agent message attribution", () => {
  it("attributes a subagent session's turns to the id's parent prefix", () => {
    expect(
      resolveParentAgentSenderSessionId({
        sessionId: "agentsession-root:subagent:translator",
      })
    ).toBe("agentsession-root");
  });

  it("prefers the persisted parent link over the id prefix", () => {
    expect(
      resolveParentAgentSenderSessionId({
        sessionId: "agentsession-root:subagent:translator",
        parentSessionId: "  agentsession-orchestrator  ",
      })
    ).toBe("agentsession-orchestrator");
  });

  it("attributes an Agent Team member session to its parent", () => {
    expect(
      resolveParentAgentSenderSessionId({
        sessionId: "member-session-1",
        parentSessionId: "agentsession-root",
        orgMemberId: "member-1",
      })
    ).toBe("agentsession-root");
  });

  it("attributes a background child session to its parent", () => {
    expect(
      resolveParentAgentSenderSessionId({
        sessionId: "background-session-1",
        parentSessionId: "agentsession-root",
        background: true,
      })
    ).toBe("agentsession-root");
  });

  it("leaves an ordinary continuation session with the viewer", () => {
    expect(
      resolveParentAgentSenderSessionId({
        sessionId: "continued-session",
        parentSessionId: "imported-source",
        background: false,
      })
    ).toBeNull();
  });

  it("leaves a plain session with the viewer", () => {
    expect(
      resolveParentAgentSenderSessionId({ sessionId: "agentsession-solo" })
    ).toBeNull();
  });

  it("returns null when a subagent-shaped id has no identifiable parent", () => {
    expect(
      resolveParentAgentSenderSessionId({ sessionId: ":subagent:orphan" })
    ).toBeNull();
  });
});
