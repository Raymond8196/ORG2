import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { syncTodosFromReplayEvents } from "../syncTodosFromReplayEvents";

function nativeTodoContent(
  header: string,
  todos: Array<Record<string, unknown>>
): string {
  return [
    header,
    JSON.stringify(todos, null, 2),
    "",
    "Ensure that you continue to use the todo list to track your progress.",
  ].join("\n");
}

function makeManageTodoEvent(
  overrides: Partial<SessionEvent> & Pick<SessionEvent, "id">
): SessionEvent {
  return {
    chunk_id: overrides.id,
    sessionId: "session-a",
    createdAt: "2026-01-01T00:00:00.000Z",
    functionName: "manage_todo",
    uiCanonical: "manage_todo",
    actionType: "tool_call",
    args: {},
    result: {
      content: nativeTodoContent("1 todo (1 remaining)", [
        { index: 0, content: "Do work", status: "pending" },
      ]),
    },
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "processed",
    ...overrides,
  };
}

describe("syncTodosFromReplayEvents", () => {
  it("returns null when pipeline session does not match", () => {
    const events = [makeManageTodoEvent({ id: "todo-1" })];
    expect(
      syncTodosFromReplayEvents({
        sessionId: "session-a",
        pipelineSessionId: "session-b",
        liveEvents: events,
        simulatorEvents: [],
        currentEvent: null,
        lastSnapshot: null,
      })
    ).toBeNull();
  });

  it("derives todos from live events when pipeline matches", () => {
    const events = [makeManageTodoEvent({ id: "todo-1" })];
    const result = syncTodosFromReplayEvents({
      sessionId: "session-a",
      pipelineSessionId: "session-a",
      liveEvents: events,
      simulatorEvents: [],
      currentEvent: null,
      lastSnapshot: null,
    });
    expect(result).not.toBeNull();
    expect(result?.snapshot).toBeTruthy();
  });
});
