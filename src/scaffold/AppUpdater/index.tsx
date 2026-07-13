import { getVersion } from "@tauri-apps/api/app";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { atom, useAtomValue } from "jotai";
import React, { useEffect, useRef } from "react";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import { autoUpdateEnabledAtom } from "@src/store/platform/autoUpdateAtom";
import { settingsLoadedAtom } from "@src/store/settings/settingsAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  AppUpdaterCoordinator,
  type AppUpdaterState,
  createInitialAppUpdaterState,
} from "./appUpdaterCoordinator";
import {
  AppUpdaterScheduler,
  type AutomaticUpdateReason,
} from "./appUpdaterScheduler";

const log = createLogger("AppUpdater");

const STARTUP_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60_000;
const FOREGROUND_CHECK_MIN_INTERVAL_MS = 5 * 60_000;
const FOREGROUND_EVENT_DEBOUNCE_MS = 750;
const INSTALL_PROGRESS_MESSAGE_MIN_INTERVAL_MS = 2_000;
const UPDATE_TOAST_DURATION_MS = 5_000;

const CHECK_TOAST_ID = "app-update-check";
const INSTALL_TOAST_ID = "app-update-progress";

export interface CheckForAppUpdatesOptions {
  notify?: boolean;
  force?: boolean;
}

const appUpdaterStateAtom = atom<AppUpdaterState>(
  createInitialAppUpdaterState()
);
const availableAppUpdateAtom = atom((get) => get(appUpdaterStateAtom).update);
const isAppUpdateInstallingAtom = atom((get) => {
  const phase = get(appUpdaterStateAtom).phase;
  return (
    phase === "downloading" || phase === "installing" || phase === "relaunching"
  );
});

function store() {
  return getInstrumentedStore();
}

function createCoordinator(): AppUpdaterCoordinator {
  return new AppUpdaterCoordinator({
    check,
    getVersion,
    minCheckIntervalMs: FOREGROUND_CHECK_MIN_INTERVAL_MS,
    onStateChange: (state) => store().set(appUpdaterStateAtom, state),
  });
}

const coordinator = createCoordinator();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

function notifyCheckSuccess(
  update: Update | null,
  currentVersion: string | undefined,
  notify: boolean
): void {
  if (!notify) return;

  if (update) {
    Message.info({
      id: CHECK_TOAST_ID,
      title: "Update available",
      content: `Version ${update.version} is ready to install.`,
      duration: UPDATE_TOAST_DURATION_MS,
    });
    return;
  }

  Message.success({
    id: CHECK_TOAST_ID,
    content: currentVersion
      ? `ORGII is up to date (v${currentVersion}).`
      : "ORGII is up to date.",
    duration: UPDATE_TOAST_DURATION_MS,
  });
}

function notifyCheckFailure(error: unknown, notify: boolean): void {
  const message = getErrorMessage(error);
  log.warn("Update check failed", message);

  if (!notify) return;
  Message.error({
    id: CHECK_TOAST_ID,
    title: "Update check failed",
    content: message,
    duration: UPDATE_TOAST_DURATION_MS,
  });
}

export async function checkForAppUpdates(
  options: CheckForAppUpdatesOptions = {}
): Promise<Update | null> {
  const { notify = false, force = false } = options;

  if (notify) {
    Message.info({
      id: CHECK_TOAST_ID,
      content: "Checking for updates…",
      duration: 0,
    });
  }

  try {
    const result = await coordinator.checkForUpdate(force);
    notifyCheckSuccess(result.update, result.currentVersion, notify);
    return result.update;
  } catch (error) {
    // A manual check is an explicit freshness request. Do not keep showing an
    // update that this check could not confirm. Silent failures keep the last
    // successful result so transient network loss does not erase UI state.
    if (notify) coordinator.clearAvailableUpdate();
    notifyCheckFailure(error, notify);
    return notify ? null : coordinator.getAvailableUpdate();
  }
}

export async function checkForUpdatesManually(): Promise<Update | null> {
  return checkForAppUpdates({ notify: true, force: true });
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function createProgressReporter(): (event: DownloadEvent) => void {
  let lastReportedAt = 0;
  let downloaded = 0;
  let total: number | null = null;

  const describe = (event: DownloadEvent): string => {
    switch (event.event) {
      case "Started":
        return total
          ? `Downloading update (${formatBytes(total)})…`
          : "Downloading update…";
      case "Progress": {
        if (!total) return `Downloading update… ${formatBytes(downloaded)}`;
        const percent = Math.min(100, Math.round((downloaded / total) * 100));
        return `Downloading update… ${percent}%`;
      }
      case "Finished":
        return "Installing update…";
    }
  };

  return (event) => {
    if (event.event === "Started") {
      downloaded = 0;
      total = event.data.contentLength ?? null;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }

    const now = Date.now();
    const shouldReport =
      event.event !== "Progress" ||
      now - lastReportedAt >= INSTALL_PROGRESS_MESSAGE_MIN_INTERVAL_MS;
    if (!shouldReport) return;

    lastReportedAt = now;
    Message.info({
      id: INSTALL_TOAST_ID,
      content: describe(event),
      duration: event.event === "Finished" ? 1500 : 2200,
    });
  };
}

async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

export async function installAvailableAppUpdate(): Promise<void> {
  const update =
    coordinator.getAvailableUpdate() ?? (await checkForUpdatesManually());
  if (!update) return;

  try {
    Message.info({
      id: INSTALL_TOAST_ID,
      title: "Installing update",
      content: `Preparing v${update.version}…`,
      duration: 0,
    });

    const installed = await coordinator.installAvailableUpdate(
      createProgressReporter()
    );
    if (!installed) return;

    Message.success({
      id: INSTALL_TOAST_ID,
      title: "Update installed",
      content: "Restarting ORGII to finish the update.",
      duration: 2500,
    });
    await relaunchApp();
  } catch (error) {
    Message.error({
      id: INSTALL_TOAST_ID,
      title: "Update install failed",
      content: getErrorMessage(error),
      duration: 6000,
    });
    log.error("Update install failed", error);
  }
}

async function runAutomaticUpdate(
  reason: AutomaticUpdateReason
): Promise<void> {
  try {
    const result = await coordinator.checkForUpdate(
      reason === "startup" || reason === "interval"
    );
    if (!result.update) return;

    if (reason === "startup") {
      const installed = await coordinator.installAvailableUpdate();
      if (installed) await relaunchApp();
      return;
    }

    // Installing can terminate the app on Windows. While the user is active,
    // only download in the background; the existing update button can install
    // immediately from the prepared package, or startup auto-update will.
    await coordinator.downloadAvailableUpdate();
  } catch (error) {
    log.warn(`Automatic update (${reason}) failed`, getErrorMessage(error));
  }
}

export function useAvailableAppUpdate(): Update | null {
  return useAtomValue(availableAppUpdateAtom);
}

export function useIsAppUpdateInstalling(): boolean {
  return useAtomValue(isAppUpdateInstallingAtom);
}

export const AppUpdater: React.FC = () => {
  const autoUpdateEnabled = useAtomValue(autoUpdateEnabledAtom);
  const settingsLoaded = useAtomValue(settingsLoadedAtom);
  const startupSchedulingPendingRef = useRef(true);

  useEffect(() => {
    if (!settingsLoaded) return;
    const scheduleStartupInstall = startupSchedulingPendingRef.current;
    startupSchedulingPendingRef.current = false;
    if (!autoUpdateEnabled) return;

    const scheduler = new AppUpdaterScheduler({
      startupDelayMs: scheduleStartupInstall ? STARTUP_CHECK_DELAY_MS : null,
      intervalMs: UPDATE_CHECK_INTERVAL_MS,
      foregroundDebounceMs: FOREGROUND_EVENT_DEBOUNCE_MS,
    });
    scheduler.start((reason) => {
      void runAutomaticUpdate(reason);
    });
    if (!scheduleStartupInstall) void runAutomaticUpdate("foreground");
    return () => scheduler.stop();
  }, [autoUpdateEnabled, settingsLoaded]);

  return null;
};

/** Test-only reset for the module singleton. */
export function resetAppUpdaterForTests(): void {
  coordinator.reset();
}
