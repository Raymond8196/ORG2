/**
 * useBackgroundSessionMonitor Hook
 *
 * Owns the single window-level CLI lifecycle status subscription. It routes
 * every CLI status through the global coordinator and additionally delivers
 * notifications: foreground turns can play a sound, background ("fire and
 * forget") turns can also raise system notifications.
 *
 * This hook runs at the app root level (via GlobalSessionSync) so it is
 * always active, regardless of which view the user is on.
 *
 * Active adapters remain responsible for transcript/UI mirroring only; turn
 * finality for active and background sessions is owned here.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { getCodeEditorWebSocket } from "@src/api/realtime/codeEditorWebSocket";
import {
  TASK_FAILURE_NOTIFICATION_BODY,
  configureNotificationRuntime,
  disposeNotificationRuntime,
  isPrimaryNotificationWindow,
  markNotificationRunStarted,
  notifyError,
  notifyTaskCompletion,
  setBackgroundCompletionSummaryListener,
  terminalNotificationEventKey,
} from "@src/api/services/notification";
import {
  isNotificationAttentionRequired,
  isSuccessfulNotificationTurnStatus,
} from "@src/api/services/notificationPolicy";
import { registerNotificationSoundUnlock } from "@src/api/services/notificationSound";
import Message from "@src/components/Message";
import { notificationSettingsAtom } from "@src/store/ui/notificationAtom";
import { isTerminalStatus } from "@src/types/session/session";

import { cliTurnLifecycleCoordinator } from "./cliTurnLifecycleCoordinator";

interface BackgroundStatusMessage {
  type: "code_session.status_changed";
  session_id: string;
  status: string;
  background?: boolean;
  session_name?: string;
  error_message?: string;
  exit_code?: number;
  turn_intent_id?: string;
  plan_gate?: boolean;
}

export function useBackgroundSessionMonitor(): void {
  const notificationSettings = useAtomValue(notificationSettingsAtom);

  const settingsRef = useRef(notificationSettings);
  useEffect(() => {
    settingsRef.current = notificationSettings;
    configureNotificationRuntime(notificationSettings);
  }, [notificationSettings]);

  useEffect(() => {
    const unregisterSoundUnlock = isPrimaryNotificationWindow()
      ? registerNotificationSoundUnlock({
          shouldUnlock: () => settingsRef.current.soundEnabled,
        })
      : () => undefined;
    const reconcileRuntime = () => {
      configureNotificationRuntime(settingsRef.current);
    };
    const handleRuntimeVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileRuntime();
    };
    const unsubscribeSummary = setBackgroundCompletionSummaryListener(
      (summary) => {
        const names = summary.sessionNames.join(", ");
        const suffix = names ? `: ${names}` : "";
        Message.success({
          content: `${summary.count} background task${summary.count === 1 ? "" : "s"} completed${suffix}`,
          duration: 8000,
          closable: true,
        });
      }
    );
    configureNotificationRuntime(settingsRef.current);
    window.addEventListener("focus", reconcileRuntime);
    window.addEventListener("pageshow", reconcileRuntime);
    document.addEventListener(
      "visibilitychange",
      handleRuntimeVisibilityChange
    );

    return () => {
      unregisterSoundUnlock();
      unsubscribeSummary();
      disposeNotificationRuntime();
      window.removeEventListener("focus", reconcileRuntime);
      window.removeEventListener("pageshow", reconcileRuntime);
      document.removeEventListener(
        "visibilitychange",
        handleRuntimeVisibilityChange
      );
    };
  }, []);

  useEffect(() => {
    const wsClient = getCodeEditorWebSocket();
    if (!wsClient) return;

    const unsubscribe = wsClient.on("code_session.status_changed", (raw) => {
      const msg = raw as unknown as BackgroundStatusMessage;
      const applied = cliTurnLifecycleCoordinator.handleStatus({
        sessionId: msg.session_id,
        status: msg.status,
        turnIntentId: msg.turn_intent_id,
      });

      if (msg.status === "running") {
        markNotificationRunStarted(msg.session_id);
        return;
      }

      const completedTurn = isSuccessfulNotificationTurnStatus(msg.status);
      const terminal = isTerminalStatus(msg.status);
      if (!completedTurn && !terminal) return;
      // The coordinator owns turn finality for terminal statuses: a rejected
      // one is stale (superseded turn intent) and must not notify. Non-terminal
      // successful turns (`idle`, used by Agent Org members) are not
      // coordinator-owned, so they are not gated on it.
      if (terminal && !applied) return;

      const isBackgroundSession = msg.background === true;
      const needsAttention =
        isNotificationAttentionRequired(isBackgroundSession);
      const sessionName = msg.session_name || "Background session";

      if (completedTurn) {
        if (msg.plan_gate) {
          // Burn the event key so a later real completion for this run is not
          // deduped against the plan-approval pause.
          terminalNotificationEventKey(msg.session_id, "completed");
          return;
        }
        void notifyTaskCompletion(
          `"${sessionName}" completed — ready for review`,
          settingsRef.current,
          {
            sessionId: msg.session_id,
            background: needsAttention,
            eventKey: terminalNotificationEventKey(msg.session_id, "completed"),
          },
          sessionName
        ).then((result) => {
          if (result.disposition !== "delivered" || !needsAttention) return;
          Message.success({
            content: `"${sessionName}" completed. Click to review diff.`,
            duration: 0,
            closable: true,
          });
        });
      } else if (msg.status === "failed") {
        const errorDetail = msg.error_message
          ? `: ${msg.error_message.slice(0, 120)}`
          : "";

        void notifyError(TASK_FAILURE_NOTIFICATION_BODY, settingsRef.current, {
          sessionId: msg.session_id,
          background: needsAttention,
          eventKey: terminalNotificationEventKey(msg.session_id, "failed"),
        }).then((result) => {
          if (result.disposition !== "delivered" || !needsAttention) return;
          Message.error({
            content: `"${sessionName}" failed${errorDetail}`,
            duration: 8000,
            closable: true,
          });
        });
      } else if (msg.status === "cancelled" && isBackgroundSession) {
        Message.warning({
          content: `"${sessionName}" was cancelled`,
          duration: 5000,
        });
      }
    });

    const reconcile = () => {
      void cliTurnLifecycleCoordinator.reconcile();
    };
    const unsubscribeConnected = wsClient.on("connected", reconcile);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", reconcile);

    return () => {
      unsubscribe();
      unsubscribeConnected();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", reconcile);
    };
  }, []);
}
