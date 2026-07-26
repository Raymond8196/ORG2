import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { createLogger } from "@src/hooks/logger";
import type {
  BackgroundCompletionSummary,
  NotificationCategory,
  NotificationContext,
  NotificationDeliveryResult,
  NotificationSettings,
} from "@src/types/ui/notification";

import {
  NotificationEventDeduper,
  NotificationRunTracker,
  evaluateNotificationPolicy,
} from "./notificationPolicy";
import {
  type NotificationSoundPlaybackOptions,
  playNotificationSound as playSelectedNotificationSound,
  unlockNotificationSound as unlockSelectedNotificationSound,
} from "./notificationSound";
import { BackgroundCompletionSummaryCoordinator } from "./notificationSummaryCoordinator";

const log = createLogger("Notification");

export const TASK_FAILURE_NOTIFICATION_BODY =
  "A task failed. Open ORGII for details.";

export interface NotificationOptions {
  title: string;
  body: string;
  category?: NotificationCategory;
  playSound?: boolean;
  context?: NotificationContext;
  summaryLabel?: string;
}

type BackgroundCompletionSummaryListener = (
  summary: BackgroundCompletionSummary
) => void;

let backgroundCompletionSummaryListener: BackgroundCompletionSummaryListener | null =
  null;
let anonymousSummaryEventSequence = 0;
const notificationEventDeduper = new NotificationEventDeduper();
const notificationRunTracker = new NotificationRunTracker();

export function isPrimaryNotificationWindow(): boolean {
  try {
    return !isTauri() || getCurrentWindow().label === "main";
  } catch {
    return false;
  }
}

export function markNotificationRunStarted(sessionId: string): void {
  notificationRunTracker.markRunning(sessionId);
}

export function terminalNotificationEventKey(
  sessionId: string,
  status: "completed" | "failed"
): string {
  return notificationRunTracker.terminalEventKey(sessionId, status);
}

/**
 * Check notification permission status
 */
export const checkNotificationPermission = async (): Promise<string> => {
  try {
    const granted = await isPermissionGranted();
    return granted ? "granted" : "denied";
  } catch (error) {
    log.error(
      "[Notification] Permission check failed, trying Rust command:",
      error
    );
    try {
      return await invoke<string>("check_notification_permission");
    } catch (invokeError) {
      log.error("[Notification] Rust command also failed:", invokeError);
      return "unknown";
    }
  }
};

/**
 * Request notification permission
 */
export const requestNotificationPermission = async (): Promise<string> => {
  try {
    const permission = await requestPermission();
    return permission === "granted"
      ? "granted"
      : permission === "denied"
        ? "denied"
        : "unknown";
  } catch (error) {
    log.error(
      "[Notification] Permission request failed, trying Rust command:",
      error
    );
    try {
      return await invoke<string>("request_notification_permission");
    } catch (invokeError) {
      log.error("[Notification] Rust command also failed:", invokeError);
      return "denied";
    }
  }
};

/**
 * Send a system notification
 */
export const sendSystemNotification = async (
  title: string,
  body: string
): Promise<boolean> => {
  try {
    await sendNotification({ title, body });
    return true;
  } catch (error) {
    log.error("[Notification] Send failed, trying Rust command:", error);
    try {
      await invoke("send_notification", { title, body });
      return true;
    } catch (invokeError) {
      log.error("[Notification] Rust command also failed:", invokeError);
      return false;
    }
  }
};

/**
 * Play the user's selected notification sound.
 */
export const playNotificationSound = (
  options: NotificationSoundPlaybackOptions
): Promise<boolean> => playSelectedNotificationSound(options);

export const unlockNotificationSound = (): Promise<boolean> =>
  unlockSelectedNotificationSound();

async function deliverNotification(
  options: NotificationOptions,
  settings: NotificationSettings,
  decision: {
    sendSystemNotification: boolean;
    playSound: boolean;
  }
): Promise<
  Pick<NotificationDeliveryResult, "systemNotificationSent" | "soundPlayed">
> {
  let systemNotificationSent = false;
  if (decision.sendSystemNotification) {
    systemNotificationSent = await sendSystemNotification(
      options.title,
      options.body
    );
  }

  const soundPlayed = decision.playSound
    ? await playNotificationSound({
        preset: settings.soundPreset,
        volume: settings.soundVolume,
      })
    : false;

  return {
    systemNotificationSent,
    soundPlayed,
  };
}

const backgroundCompletionSummaryCoordinator =
  new BackgroundCompletionSummaryCoordinator(async (summary, settings) => {
    const visibleNames = summary.sessionNames.join(", ");
    const remaining = Math.max(0, summary.count - summary.sessionNames.length);
    const body = visibleNames
      ? remaining > 0
        ? `${visibleNames} and ${remaining} more`
        : visibleNames
      : `${summary.count} background tasks are ready for review`;

    const options: NotificationOptions = {
      title: `${summary.count} background task${summary.count === 1 ? "" : "s"} completed`,
      body,
      category: "taskCompletion",
      playSound: true,
    };
    const decision = evaluateNotificationPolicy(
      {
        category: options.category,
        playSound: true,
      },
      settings
    );

    if (decision.disposition !== "deliver") {
      return decision.reason !== "quiet-hours";
    }

    const delivery = await deliverNotification(options, settings, decision);
    let inAppDelivered = false;

    if (backgroundCompletionSummaryListener) {
      try {
        backgroundCompletionSummaryListener(summary);
        inAppDelivered = true;
      } catch (error) {
        log.error("[Notification] Summary listener failed:", error);
      }
    }

    return (
      delivery.systemNotificationSent || delivery.soundPlayed || inAppDelivered
    );
  });

/** Keep the one-shot summary boundary timer aligned with live settings. */
export function configureNotificationRuntime(
  settings: NotificationSettings
): void {
  if (!isPrimaryNotificationWindow()) return;
  backgroundCompletionSummaryCoordinator.configure(settings);
}

export function disposeNotificationRuntime(): void {
  backgroundCompletionSummaryCoordinator.dispose();
}

export function setBackgroundCompletionSummaryListener(
  listener: BackgroundCompletionSummaryListener | null
): () => void {
  backgroundCompletionSummaryListener = listener;
  return () => {
    if (backgroundCompletionSummaryListener === listener) {
      backgroundCompletionSummaryListener = null;
    }
  };
}

/**
 * Send a notification based on settings
 */
export const notify = async (
  options: NotificationOptions,
  settings: NotificationSettings
): Promise<NotificationDeliveryResult> => {
  if (!isPrimaryNotificationWindow()) {
    return {
      disposition: "suppressed",
      systemNotificationSent: false,
      soundPlayed: false,
      reason: "non-primary-window",
    };
  }

  const eventKey = options.context?.eventKey;
  if (eventKey && !notificationEventDeduper.shouldDeliver(eventKey)) {
    return {
      disposition: "suppressed",
      systemNotificationSent: false,
      soundPlayed: false,
      reason: "duplicate",
    };
  }

  configureNotificationRuntime(settings);
  const decision = evaluateNotificationPolicy(
    {
      category: options.category,
      context: options.context,
      playSound: options.playSound !== false,
    },
    settings
  );

  if (decision.disposition === "defer") {
    backgroundCompletionSummaryCoordinator.enqueue(
      {
        eventKey:
          options.context?.eventKey ??
          `summary:${Date.now()}:${++anonymousSummaryEventSequence}`,
        sessionId: options.context?.sessionId,
        sessionName: options.summaryLabel ?? options.body,
      },
      settings
    );
    return {
      disposition: "deferred",
      systemNotificationSent: false,
      soundPlayed: false,
      reason: decision.reason,
    };
  }

  if (decision.disposition === "suppress") {
    return {
      disposition: "suppressed",
      systemNotificationSent: false,
      soundPlayed: false,
      reason: decision.reason,
    };
  }

  const delivery = await deliverNotification(options, settings, decision);
  return {
    disposition: "delivered",
    ...delivery,
  };
};

/**
 * Notify task completion
 */
export const notifyTaskCompletion = async (
  taskName: string,
  settings: NotificationSettings,
  context?: NotificationContext,
  summaryLabel: string = taskName
): Promise<NotificationDeliveryResult> => {
  return notify(
    {
      title: "Task Completed",
      body: taskName,
      category: "taskCompletion",
      playSound: true,
      context,
      summaryLabel,
    },
    settings
  );
};

/**
 * Notify agent approval needed
 */
export const notifyAgentApproval = async (
  actionName: string,
  settings: NotificationSettings,
  context?: NotificationContext
): Promise<NotificationDeliveryResult> => {
  return notify(
    {
      title: "Action Requires Approval",
      body: actionName,
      category: "agentApproval",
      playSound: true,
      context,
    },
    settings
  );
};

/**
 * Notify error
 */
export const notifyError = async (
  errorMessage: string,
  settings: NotificationSettings,
  context?: NotificationContext
): Promise<NotificationDeliveryResult> => {
  return notify(
    {
      title: "Error",
      body: errorMessage,
      category: "errors",
      playSound: true,
      context,
    },
    settings
  );
};

/**
 * Notify session status change
 */
export const notifySessionStatus = async (
  status: string,
  settings: NotificationSettings,
  context?: NotificationContext
): Promise<NotificationDeliveryResult> => {
  return notify(
    {
      title: "Session Status",
      body: status,
      category: "sessionStatus",
      playSound: false,
      context,
    },
    settings
  );
};

/**
 * Notify git operation
 */
export const notifyGitOperation = async (
  operation: string,
  settings: NotificationSettings
): Promise<NotificationDeliveryResult> => {
  return notify(
    {
      title: "Git Operation",
      body: operation,
      category: "gitOperations",
      playSound: false,
    },
    settings
  );
};

/**
 * Test notification - sends a test notification and plays sound
 */
export const sendTestNotification = async (
  settings: NotificationSettings
): Promise<boolean> => {
  const result = await deliverNotification(
    {
      title: "Test Notification",
      body: "This is a test notification from ORGII",
      category: "taskCompletion",
      playSound: true,
    },
    settings,
    {
      sendSystemNotification: true,
      playSound: settings.soundEnabled,
    }
  );
  return result.systemNotificationSent;
};
