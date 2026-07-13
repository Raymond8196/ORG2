import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkForUpdatesManually,
  installAvailableAppUpdate,
  resetAppUpdaterForTests,
} from "./index";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  relaunch: vi.fn(),
  storeSet: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

vi.mock("@src/components/Message", () => ({
  default: {
    error: mocks.messageError,
    info: mocks.messageInfo,
    success: mocks.messageSuccess,
  },
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({
    set: mocks.storeSet,
  }),
}));

function createUpdate(overrides: Partial<Update> = {}): Update {
  return {
    available: true,
    close: vi.fn().mockResolvedValue(undefined),
    currentVersion: "1.1.21",
    download: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    version: "1.1.22",
    ...overrides,
  } as unknown as Update;
}

describe("AppUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVersion.mockResolvedValue("1.1.21");
    resetAppUpdaterForTests();
  });

  it("checks for updates without requiring a browser-exposed Tauri global", async () => {
    const update = createUpdate();
    mocks.check.mockResolvedValue(update);

    await expect(checkForUpdatesManually()).resolves.toBe(update);

    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.messageInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Version 1.1.22 is ready to install.",
        title: "Update available",
      })
    );
  });

  it("clears a stale available update after a failed manual check", async () => {
    const update = createUpdate();
    mocks.check
      .mockResolvedValueOnce(update)
      .mockRejectedValueOnce(new Error("offline"));
    await checkForUpdatesManually();

    await expect(checkForUpdatesManually()).resolves.toBeNull();

    expect(update.close).toHaveBeenCalledOnce();
    expect(mocks.messageError).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Update check failed" })
    );
  });

  it("checks, installs, and relaunches when no update is cached", async () => {
    const update = createUpdate();
    mocks.check.mockResolvedValue(update);

    await installAvailableAppUpdate();

    expect(mocks.check).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("throttles download progress messages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const update = createUpdate({
      downloadAndInstall: vi.fn(async (onEvent) => {
        const report = onEvent as (event: DownloadEvent) => void;
        report({ event: "Started", data: { contentLength: 100 } });
        report({ event: "Progress", data: { chunkLength: 10 } });
        vi.setSystemTime(12_000);
        report({ event: "Progress", data: { chunkLength: 40 } });
        report({ event: "Finished" });
      }),
    });
    mocks.check.mockResolvedValue(update);

    await installAvailableAppUpdate();

    const progressMessages = mocks.messageInfo.mock.calls.filter(
      ([message]) => message.id === "app-update-progress"
    );
    expect(progressMessages).toHaveLength(4);
    expect(progressMessages[2]?.[0].content).toBe("Downloading update… 50%");
    vi.useRealTimers();
  });
});
