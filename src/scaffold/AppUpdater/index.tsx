import { getVersion } from "@tauri-apps/api/app";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { atom, useAtomValue } from "jotai";
import React, { useEffect } from "react";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const log = createLogger("AppUpdater");

const STARTUP_CHECK_DELAY_MS = 10_000;
// Background poll is intentionally long: focus/visibilitychange checks (throttled
// by FOREGROUND_CHECK_MIN_INTERVAL_MS) cover active users, so the timer only
// matters for a window left focused for hours without any focus events.
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60_000;
const FOREGROUND_CHECK_MIN_INTERVAL_MS = 5 * 60_000;
const INSTALL_PROGRESS_MESSAGE_MIN_INTERVAL_MS = 2_000;
const UPDATE_TOAST_DURATION_MS = 5_000;

// Reused toast slots so status updates replace in place instead of stacking.
const CHECK_TOAST_ID = "app-update-check";
const INSTALL_TOAST_ID = "app-update-progress";

interface CheckForAppUpdatesOptions {
  notify?: boolean;
  force?: boolean;
}

const availableAppUpdateAtom = atom<Update | null>(null);
const isAppUpdateInstallingAtom = atom(false);

let lastCheckStartedAt = 0;
let pendingCheck: Promise<Update | null> | null = null;

function canUseTauriUpdater(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function store() {
  return getInstrumentedStore();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

function getCachedUpdate(): Update | null {
  return store().get(availableAppUpdateAtom);
}

function setCachedUpdate(update: Update | null): void {
  store().set(availableAppUpdateAtom, update);
}

function shouldReuseRecentResult(force: boolean): boolean {
  return (
    !force && Date.now() - lastCheckStartedAt < FOREGROUND_CHECK_MIN_INTERVAL_MS
  );
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
      content: `Version ${update.version} is ready to download.`,
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

async function runUpdateCheck(notify: boolean): Promise<Update | null> {
  lastCheckStartedAt = Date.now();

  if (notify) {
    Message.info({
      id: CHECK_TOAST_ID,
      content: "Checking for updates…",
      duration: 0,
    });
  }

  try {
    const [currentVersion, update] = await Promise.all([
      getVersion().catch(() => undefined),
      check(),
    ]);

    setCachedUpdate(update);

    if (update) {
      log.info("Update available", {
        currentVersion: update.currentVersion || currentVersion,
        version: update.version,
      });
    }

    notifyCheckSuccess(update, currentVersion, notify);
    return update;
  } catch (error) {
    notifyCheckFailure(error, notify);
    return getCachedUpdate();
  } finally {
    pendingCheck = null;
  }
}

export async function checkForAppUpdates(
  options: CheckForAppUpdatesOptions = {}
): Promise<Update | null> {
  const { notify = false, force = false } = options;

  if (!canUseTauriUpdater()) {
    if (notify) {
      Message.info("Update checks are only available in the desktop app.");
    }
    return null;
  }

  if (pendingCheck) return pendingCheck;
  if (shouldReuseRecentResult(force)) return getCachedUpdate();

  pendingCheck = runUpdateCheck(notify);
  return pendingCheck;
}

export async function checkForUpdatesManually(): Promise<Update | null> {
  return checkForAppUpdates({ notify: true, force: true });
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Tracks cumulative download progress so the toast reflects real percentage
// (or downloaded size when the server omits Content-Length) instead of a
// static string. `Started`/`Finished` always report; `Progress` is throttled.
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

export async function installAvailableAppUpdate(): Promise<void> {
  if (!canUseTauriUpdater()) {
    Message.info("Updates can only be installed in the desktop app.");
    return;
  }

  const update = getCachedUpdate() ?? (await checkForUpdatesManually());
  if (!update || store().get(isAppUpdateInstallingAtom)) return;

  store().set(isAppUpdateInstallingAtom, true);

  try {
    Message.info({
      id: INSTALL_TOAST_ID,
      title: "Installing update",
      content: `Preparing to download v${update.version}…`,
      duration: 0,
    });

    await update.downloadAndInstall(createProgressReporter());

    Message.success({
      id: INSTALL_TOAST_ID,
      title: "Update installed",
      content: "Restarting ORGII to finish the update.",
      duration: 2500,
    });

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    Message.error({
      id: INSTALL_TOAST_ID,
      title: "Update install failed",
      content: getErrorMessage(error),
      duration: 6000,
    });
    log.error("Update install failed", error);
  } finally {
    store().set(isAppUpdateInstallingAtom, false);
  }
}

export function useAvailableAppUpdate(): Update | null {
  return useAtomValue(availableAppUpdateAtom);
}

export function useIsAppUpdateInstalling(): boolean {
  return useAtomValue(isAppUpdateInstallingAtom);
}

export const AppUpdater: React.FC = () => {
  useEffect(() => {
    if (!canUseTauriUpdater()) return undefined;

    const startupTimer = window.setTimeout(() => {
      void checkForAppUpdates();
    }, STARTUP_CHECK_DELAY_MS);

    const interval = window.setInterval(() => {
      void checkForAppUpdates({ force: true });
    }, UPDATE_CHECK_INTERVAL_MS);

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkForAppUpdates();
    };

    window.addEventListener("focus", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  return null;
};
