import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkForUpdatesManually, installAvailableAppUpdate } from "./index";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  relaunch: vi.fn(),
  storeGet: vi.fn(),
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
    get: mocks.storeGet,
    set: mocks.storeSet,
  }),
}));

describe("AppUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeGet.mockReturnValue(null);
  });

  it("checks for updates without requiring a browser-exposed Tauri global", async () => {
    const update = {
      available: true,
      currentVersion: "1.1.19",
      downloadAndInstall: vi.fn(),
      version: "1.1.20",
    };
    mocks.getVersion.mockResolvedValue("1.1.19");
    mocks.check.mockResolvedValue(update);

    await expect(checkForUpdatesManually()).resolves.toBe(update);

    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.messageInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Version 1.1.20 is ready to download.",
        title: "Update available",
      })
    );
  });

  it("checks, installs, and relaunches when no update is cached", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    mocks.getVersion.mockResolvedValue("1.1.19");
    mocks.check.mockResolvedValue({
      available: true,
      currentVersion: "1.1.19",
      downloadAndInstall,
      version: "1.1.20",
    });

    await installAvailableAppUpdate();

    expect(mocks.check).toHaveBeenCalledOnce();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });
});
