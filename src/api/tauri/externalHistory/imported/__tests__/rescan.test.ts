import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  externalHistoryRescanSource,
  externalHistoryRescanSources,
} from "../../rescan";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("external history rescans", () => {
  beforeEach(() => invokeMock.mockReset().mockResolvedValue(undefined));

  it("rescans multiple sources through one IPC command", async () => {
    await externalHistoryRescanSources(["codex_app", "cline"]);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("external_history_rescan_sources", {
      sources: ["codex_app", "cline"],
      clear: false,
    });
  });

  it("keeps the single-source clear operation available", async () => {
    await externalHistoryRescanSource("codex_app", { clear: true });

    expect(invokeMock).toHaveBeenCalledWith("external_history_rescan_source", {
      source: "codex_app",
      clear: true,
    });
  });

  it("does not invoke the backend for an empty source set", async () => {
    await externalHistoryRescanSources([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("coalesces overlapping callers into one serialized source batch", async () => {
    await Promise.all([
      externalHistoryRescanSources(["codex_app", "cline"]),
      externalHistoryRescanSource("cline"),
    ]);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("external_history_rescan_sources", {
      sources: ["codex_app", "cline"],
      clear: false,
    });
  });

  it("escalates a queued source to one clear rebuild", async () => {
    await Promise.all([
      externalHistoryRescanSource("codex_app"),
      externalHistoryRescanSource("codex_app", { clear: true }),
    ]);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("external_history_rescan_source", {
      source: "codex_app",
      clear: true,
    });
  });
});
