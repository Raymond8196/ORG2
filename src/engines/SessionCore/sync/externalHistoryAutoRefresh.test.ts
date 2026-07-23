import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type TranscriptSettleState,
  refreshImportedHistorySession,
  shouldWaitForStableTranscript,
} from "./externalHistoryAutoRefresh";

const mocks = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  getAdapterForSession: vi.fn(),
}));

vi.mock("./types", () => ({
  getAdapterForSession: mocks.getAdapterForSession,
}));

describe("refreshImportedHistorySession", () => {
  beforeEach(() => {
    mocks.loadHistory.mockReset();
    mocks.getAdapterForSession.mockReset().mockReturnValue({
      category: "external_history",
      loadHistory: mocks.loadHistory,
    });
  });

  it("reloads and publishes the currently open external transcript", async () => {
    const events = [
      {
        id: "event-1",
        sessionId: "codexapp-active",
        createdAt: "2026-07-16T05:00:00.000Z",
      },
    ];
    mocks.loadHistory.mockResolvedValue(events);
    const dispatchLoadSession = vi.fn();
    const controller = new AbortController();

    await expect(
      refreshImportedHistorySession(
        "codexapp-active",
        controller.signal,
        dispatchLoadSession
      )
    ).resolves.toBe(true);

    expect(mocks.loadHistory).toHaveBeenCalledWith(
      "codexapp-active",
      controller.signal
    );
    expect(dispatchLoadSession).toHaveBeenCalledWith({
      sessionId: "codexapp-active",
      events,
      replace: true,
    });
  });

  it("does not poll a native ORGII session", async () => {
    await expect(
      refreshImportedHistorySession(
        "osagent-native",
        new AbortController().signal,
        vi.fn()
      )
    ).resolves.toBe(false);

    expect(mocks.getAdapterForSession).not.toHaveBeenCalled();
  });
});

describe("shouldWaitForStableTranscript", () => {
  it("waits for the same changed signature to remain stable", () => {
    const state: TranscriptSettleState = {
      signature: null,
      firstObservedAt: 0,
    };

    expect(shouldWaitForStableTranscript(state, "100:200", 1_000, 5_000)).toBe(
      true
    );
    expect(shouldWaitForStableTranscript(state, "100:200", 5_999, 5_000)).toBe(
      true
    );
    expect(shouldWaitForStableTranscript(state, "100:200", 6_000, 5_000)).toBe(
      false
    );
  });

  it("restarts settling when a live transcript changes again", () => {
    const state: TranscriptSettleState = {
      signature: "100:200",
      firstObservedAt: 1_000,
    };

    expect(shouldWaitForStableTranscript(state, "101:250", 5_000, 5_000)).toBe(
      true
    );
    expect(state).toEqual({ signature: "101:250", firstObservedAt: 5_000 });
  });

  it("does not block sources that cannot provide a signature", () => {
    const state: TranscriptSettleState = {
      signature: null,
      firstObservedAt: 0,
    };
    expect(shouldWaitForStableTranscript(state, null, 1_000, 5_000)).toBe(
      false
    );
  });
});
