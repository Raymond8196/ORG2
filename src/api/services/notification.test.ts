import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationSettings } from "@src/types/ui/notification";

import {
  disposeNotificationRuntime,
  notifyAgentApproval,
  notifyError,
  notifyTaskCompletion,
  sendTestNotification,
} from "./notification";

const mocks = vi.hoisted(() => ({
  playNotificationSound: vi.fn(async () => true),
  sendNotification: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: mocks.sendNotification,
}));

vi.mock("./notificationSound", () => ({
  playNotificationSound: mocks.playNotificationSound,
}));

const settings: NotificationSettings = {
  enabled: true,
  systemNotificationEnabled: false,
  soundEnabled: true,
  soundPreset: "bell",
  soundVolume: 42,
  criticalOnly: false,
  quietHours: {
    enabled: false,
    start: "23:00",
    end: "08:00",
    allowCritical: true,
  },
  backgroundCompletionSummary: true,
  mutedSessionIds: [],
  categories: {
    taskCompletion: true,
    agentApproval: true,
    errors: true,
    sessionStatus: false,
    gitOperations: false,
  },
};

describe("notification sound selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    disposeNotificationRuntime();
    vi.useRealTimers();
  });

  it.each([
    ["task completion", () => notifyTaskCompletion("Done", settings)],
    ["approval", () => notifyAgentApproval("Approve", settings)],
    ["error", () => notifyError("Failed", settings)],
  ])("uses the selected preset for %s notifications", async (_name, run) => {
    await run();

    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
    expect(mocks.playNotificationSound).toHaveBeenCalledWith({
      preset: "bell",
      volume: 42,
    });
  });

  it("uses the selected preset for the test notification", async () => {
    await sendTestNotification(settings);

    expect(mocks.playNotificationSound).toHaveBeenCalledWith({
      preset: "bell",
      volume: 42,
    });
  });

  it("disposes retained background-summary timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 23, 30));
    const quietSettings: NotificationSettings = {
      ...settings,
      quietHours: {
        ...settings.quietHours,
        enabled: true,
      },
    };

    await expect(
      notifyTaskCompletion(
        "Done",
        quietSettings,
        {
          sessionId: "summary-session",
          background: true,
          eventKey: "summary-dispose-test",
        },
        "Summary session"
      )
    ).resolves.toMatchObject({ disposition: "deferred" });
    expect(vi.getTimerCount()).toBe(1);

    disposeNotificationRuntime();
    expect(vi.getTimerCount()).toBe(0);
  });
});
