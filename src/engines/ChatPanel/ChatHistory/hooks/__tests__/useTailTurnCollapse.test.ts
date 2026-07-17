import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { GroupChatContextValue } from "../../GroupChatView/GroupChatContext";
import { findTailTurnId } from "../useTailTurnCollapse";

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "event-id",
    sessionId: "session-id",
    source: "assistant",
    args: {},
    result: {},
    ...overrides,
  } as SessionEvent;
}

describe("findTailTurnId", () => {
  it("returns the latest standard user turn and ignores inbox transcript rows", () => {
    const events = [
      event({ id: "user-1", source: "user" }),
      event({ id: "assistant-1" }),
      event({
        id: "inbox-row",
        source: "user",
        args: { agentOrgInboxTranscript: true },
      }),
    ];

    expect(findTailTurnId(events, null)).toBe("user-1");
  });

  it("uses the group-chat coordinator boundary predicate", () => {
    const events = [
      event({ id: "coordinator-turn", source: "user" }),
      event({ id: "member-turn", source: "user" }),
    ];
    const groupChat = {
      enabled: true,
      isCoordinatorTurnHeader: (candidate: SessionEvent) =>
        candidate.id === "coordinator-turn",
    } as GroupChatContextValue;

    expect(findTailTurnId(events, groupChat)).toBe("coordinator-turn");
  });

  it("returns null when no turn boundary exists", () => {
    expect(findTailTurnId([event({ id: "assistant-only" })], null)).toBeNull();
  });
});
