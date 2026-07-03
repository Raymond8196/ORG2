import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  SPAWNED_SESSION_RE,
  findSubagentParentEventId,
} from "../subagentTracking";

function toolCallEvent(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "evt-1",
    sessionId: "parent-session",
    type: "tool_call",
    actionType: "tool_call",
    functionName: "agent",
    args: {},
    result: null,
    content: "",
    timestamp: "2026-07-02T19:52:13Z",
    createdAt: "2026-07-02T19:52:13Z",
    ...overrides,
  } as SessionEvent;
}

describe("SPAWNED_SESSION_RE", () => {
  it("matches Rust-native agent session ids with agent ids containing colons", () => {
    const sessionId =
      "agent-builtin:general-0cfe485e-7f20-4158-9f0e-7d8eea3de2c9";

    expect(`Session ID: ${sessionId}`.match(SPAWNED_SESSION_RE)?.[0]).toBe(
      sessionId
    );
  });
});

describe("findSubagentParentEventId", () => {
  it("finds the parent agent tool call whose result contains the child session id", () => {
    const sessionId =
      "agent-builtin:general-0cfe485e-7f20-4158-9f0e-7d8eea3de2c9";
    const events = [
      toolCallEvent({ id: "unrelated", result: { content: "no child here" } }),
      toolCallEvent({
        id: "parent-agent-call",
        result: { content: `Subagent launched. Session ID: ${sessionId}` },
      }),
    ];

    expect(findSubagentParentEventId(events, sessionId)).toBe(
      "parent-agent-call"
    );
  });
});
