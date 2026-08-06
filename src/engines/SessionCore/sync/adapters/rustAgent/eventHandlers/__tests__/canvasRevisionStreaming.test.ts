import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { canvasRevisionDraftsAtom } from "@src/store/session/canvasRevisionDraftAtom";

import { handleToolCallDelta } from "../streamHandlers";
import { resetAllStreamingState } from "../streamHelpers";
import { handleToolCall, handleToolResult } from "../toolHandlers";
import type { EventHandlerContext } from "../types";

vi.mock(
  "@src/engines/ChatPanel/blocks/CanvasInlineCard/openInSimulatorCanvas",
  () => ({ openInSimulatorCanvas: vi.fn() })
);

function ref<T>(value: T): { current: T } {
  return { current: value };
}

function context(store: ReturnType<typeof createStore>): EventHandlerContext {
  return {
    filterSessionIdRef: ref("session-a"),
    assistantStreamRef: ref({ idRef: ref(""), contentRef: ref("") }),
    thinkingStreamRef: ref({ idRef: ref(""), contentRef: ref("") }),
    toolCallDeltaBuffersRef: ref(new Map()),
    onAgentCompleteRef: ref(undefined),
    onContextUsageRef: ref(undefined),
    onTokenUpdateRef: ref(undefined),
    onStatusChangeRef: ref(undefined),
    onQuestionRequestRef: ref(undefined),
    setStreaming: vi.fn(),
    features: { hasToolCallDelta: true },
    getDefaultStore: () => store,
  };
}

describe("Canvas revision streaming lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEventStub {
        constructor(
          public type: string,
          public init?: { detail?: unknown }
        ) {}
      }
    );
  });

  it("publishes ephemeral progress, applies the final call, then clears it", async () => {
    const store = createStore();
    const ctx = context(store);

    handleToolCallDelta(
      {
        type: "agent:tool_call_delta",
        tool: "revise_inline_canvas",
        toolCallId: "revision-a",
        index: 0,
        argumentsDelta:
          '{"target_event_id":"canvas-a","mode":"react","title":"Coffee","edits":[',
      },
      "session-a",
      ctx
    );

    expect(store.get(canvasRevisionDraftsAtom).get("session-a")).toMatchObject({
      toolCallId: "revision-a",
      targetEventId: "canvas-a",
      mode: "react",
      title: "Coffee",
      phase: "receiving",
    });

    handleToolCall(
      {
        type: "agent:tool_call",
        sessionId: "session-a",
        tool: "revise_inline_canvas",
        toolCallId: "revision-a",
        args: {
          target_event_id: "canvas-a",
          mode: "react",
          edits: [{ find: "Start", replace: "Start setup" }],
        },
      },
      "session-a",
      "session-a",
      ctx
    );

    expect(store.get(canvasRevisionDraftsAtom).get("session-a")?.phase).toBe(
      "applying"
    );

    await handleToolResult(
      {
        type: "agent:tool_result",
        sessionId: "session-a",
        tool: "revise_inline_canvas",
        toolCallId: "revision-a",
        result: "accepted",
      },
      "session-a",
      ctx
    );

    expect(store.get(canvasRevisionDraftsAtom).has("session-a")).toBe(false);
  });

  it("clears a partial draft on cancellation, error, or adapter disposal", () => {
    const store = createStore();
    const ctx = context(store);
    handleToolCallDelta(
      {
        type: "agent:tool_call_delta",
        tool: "revise_inline_canvas",
        toolCallId: "revision-a",
        argumentsDelta: '{"target_event_id":"canvas-a"',
      },
      "session-a",
      ctx
    );
    expect(store.get(canvasRevisionDraftsAtom).has("session-a")).toBe(true);

    resetAllStreamingState(ctx);

    expect(store.get(canvasRevisionDraftsAtom).has("session-a")).toBe(false);
  });
});
