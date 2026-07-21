// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { ChatHistoryProjectionResult } from "../core";
import {
  CHAT_PROJECTION_WORKER_THRESHOLD,
  useChatProjection,
} from "../useChatProjection";

const mocks = vi.hoisted(() => ({
  disposeSession: vi.fn(),
  isSupported: vi.fn(),
  projectChatHistory: vi.fn(),
  projectSnapshot: vi.fn(),
}));

vi.mock("../client", () => ({
  chatProjectionClient: {
    disposeSession: mocks.disposeSession,
    isSupported: mocks.isSupported,
    projectDelta: vi.fn(),
    projectSnapshot: mocks.projectSnapshot,
    updateOptions: vi.fn(),
  },
}));

vi.mock("../core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core")>();
  return { ...actual, projectChatHistory: mocks.projectChatHistory };
});

const options = { skipPolicy: "none" as const };
const oneEvent = [{ id: "event-1" } as SessionEvent];

function projection(itemCount: number): ChatHistoryProjectionResult {
  return {
    optimizedChatHistory: Array.from(
      { length: itemCount },
      (_, index) => ({ id: `item-${index}` }) as never
    ),
    sessionInfo: null,
    projectionRevision: 1,
    groupShapeDigest: "groups",
    itemShapeDigest: "items",
  };
}

function ProjectionProbe({
  enabled,
  events = oneEvent,
}: {
  enabled: boolean;
  events?: SessionEvent[];
}) {
  const result = useChatProjection({
    sessionId: enabled ? "session-1" : null,
    sourceVersion: 1,
    events,
    options,
    enabled,
  });
  return createElement("div", {
    "data-count": String(result.optimizedChatHistory.length),
    "data-pending": String(result.pending),
  });
}

describe("useChatProjection lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.disposeSession.mockReset();
    mocks.isSupported.mockReset();
    mocks.projectChatHistory.mockReset();
    mocks.projectSnapshot.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("does not project retained events after the session is disabled", () => {
    mocks.isSupported.mockReturnValue(false);
    mocks.projectChatHistory.mockReturnValue(projection(1));

    act(() => root.render(createElement(ProjectionProbe, { enabled: true })));
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("1");
    expect(mocks.projectChatHistory).toHaveBeenCalledTimes(1);

    act(() => root.render(createElement(ProjectionProbe, { enabled: false })));
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("0");
    expect(container.firstElementChild?.getAttribute("data-pending")).toBe(
      "false"
    );
    expect(mocks.projectChatHistory).toHaveBeenCalledTimes(1);
  });

  it("clears a completed worker projection before the same session is reopened", async () => {
    const largeEvents = Array.from(
      { length: CHAT_PROJECTION_WORKER_THRESHOLD },
      (_, index) => ({ id: `event-${index}` }) as SessionEvent
    );
    mocks.isSupported.mockReturnValue(true);
    mocks.projectSnapshot.mockResolvedValueOnce({
      result: projection(2),
      projectionRevision: 1,
      metrics: { queueWaitMs: 0, computeMs: 1, inputEvents: 2_000 },
    });

    await act(async () => {
      root.render(
        createElement(ProjectionProbe, { enabled: true, events: largeEvents })
      );
    });
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("2");

    await act(async () => {
      root.render(
        createElement(ProjectionProbe, { enabled: false, events: largeEvents })
      );
    });
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("0");
    expect(mocks.disposeSession).toHaveBeenCalledTimes(1);

    mocks.projectSnapshot.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      root.render(
        createElement(ProjectionProbe, { enabled: true, events: largeEvents })
      );
    });
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("0");
    expect(container.firstElementChild?.getAttribute("data-pending")).toBe(
      "true"
    );
  });
});
