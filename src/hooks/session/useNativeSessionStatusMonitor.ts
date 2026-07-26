/**
 * useNativeSessionStatusMonitor
 *
 * Listens for the "session-status-changed" Tauri event emitted by
 * `agent_core/lifecycle.rs` when a native (Rust) session reaches a terminal
 * state (completed / failed / cancelled).
 *
 * The event fires for ALL sessions regardless of which is active in the UI,
 * so this hook keeps `sessionsAtom` current for background sessions that the
 * user is not actively viewing — e.g. sessions launched from another window
 * whose TaskCard status should reflect the live state.
 *
 * Also listens for "session-account-switched" (the single backend
 * chokepoint event for EVERY account-switch path: session_patch, message
 * override sync, channel switch, CLI follow-up) so cross-window or
 * backend-initiated switches reach `sessionsAtom` without relying on the
 * initiating window's optimistic update.
 *
 * Completions and failures also pass through the shared notification policy:
 * foreground turns may play sound, while background turns can additionally
 * show or queue notifications.
 */
import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import {
  TASK_FAILURE_NOTIFICATION_BODY,
  notifyError,
  notifyTaskCompletion,
} from "@src/api/services/notification";
import {
  isNotificationAttentionRequired,
  isSuccessfulNotificationTurnStatus,
} from "@src/api/services/notificationPolicy";
import Message from "@src/components/Message";
import {
  markTurnRunning,
  markTurnTerminal,
  toTurnTerminalStatus,
} from "@src/engines/SessionCore/control/turnLifecycle";
import {
  type SessionStatus,
  activeSessionIdAtom,
  sessionByIdAtom,
  updateSessionStatus,
} from "@src/store/session";
import { notificationSettingsAtom } from "@src/store/ui/notificationAtom";
import { isTerminalStatus } from "@src/types/session/session";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isSessionRuntimeExecuting } from "@src/util/session/sessionRuntimeExecuting";

interface SessionStatusChangedPayload {
  sessionId: string;
  status: string;
}

interface SessionAccountSwitchedPayload {
  sessionId: string;
  fromAccountId: string | null;
  toAccountId: string;
  model: string | null;
}

interface SessionRenamedPayload {
  sessionId: string;
  name: string;
}

export function useNativeSessionStatusMonitor(): void {
  const notificationSettings = useAtomValue(notificationSettingsAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const settingsRef = useRef(notificationSettings);
  const activeSessionIdRef = useRef(activeSessionId);

  useEffect(() => {
    settingsRef.current = notificationSettings;
  }, [notificationSettings]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const unlistenPromise = listen<SessionStatusChangedPayload>(
      "session-status-changed",
      (event) => {
        const { sessionId, status } = event.payload;
        const completedTurn = isSuccessfulNotificationTurnStatus(status);
        if (completedTurn) {
          markTurnTerminal(sessionId, "completed");
        } else if (isTerminalStatus(status)) {
          markTurnTerminal(sessionId, toTurnTerminalStatus(status));
        } else if (isSessionRuntimeExecuting(status)) {
          markTurnRunning(sessionId);
        }
        updateSessionStatus(sessionId, status as SessionStatus);

        const session = getInstrumentedStore().get(sessionByIdAtom(sessionId));
        const sessionName = session?.name || "Background session";
        const isBackgroundSession = activeSessionIdRef.current !== sessionId;
        const needsAttention =
          isNotificationAttentionRequired(isBackgroundSession);
        if (completedTurn) {
          void notifyTaskCompletion(
            `"${sessionName}" completed — ready for review`,
            settingsRef.current,
            {
              sessionId,
              background: needsAttention,
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
        } else if (status === "failed") {
          void notifyError(
            TASK_FAILURE_NOTIFICATION_BODY,
            settingsRef.current,
            {
              sessionId,
              background: needsAttention,
            }
          ).then((result) => {
            if (result.disposition !== "delivered" || !needsAttention) return;
            Message.error({
              content: `"${sessionName}" failed`,
              duration: 8000,
              closable: true,
            });
          });
        }
      }
    );

    const unlistenRenamePromise = listen<SessionRenamedPayload>(
      "session-renamed",
      (event) => {
        const { sessionId, name } = event.payload;
        void (async () => {
          const [{ getInstrumentedStore }, { sessionByIdAtom, upsertSession }] =
            await Promise.all([
              import("@src/util/core/state/instrumentedStore"),
              import("@src/store/session"),
            ]);
          const store = getInstrumentedStore();
          const before = store.get(sessionByIdAtom(sessionId));
          if (!before || before.name === name) return;
          upsertSession({ ...before, name });
        })();
      }
    );

    const unlistenAccountPromise = listen<SessionAccountSwitchedPayload>(
      "session-account-switched",
      (event) => {
        const { sessionId, toAccountId, model } = event.payload;
        void (async () => {
          const [{ getInstrumentedStore }, { sessionByIdAtom, upsertSession }] =
            await Promise.all([
              import("@src/util/core/state/instrumentedStore"),
              import("@src/store/session"),
            ]);
          const store = getInstrumentedStore();
          const before = store.get(sessionByIdAtom(sessionId));
          // Unknown session (not yet loaded in this window) — the next
          // full session-list sync will carry the new account anyway.
          if (!before) return;
          if (
            before.accountId === toAccountId &&
            (model == null || before.model === model)
          )
            return;
          upsertSession({
            ...before,
            accountId: toAccountId,
            ...(model != null ? { model } : {}),
          });
        })();
      }
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      unlistenRenamePromise.then((unlisten) => unlisten());
      unlistenAccountPromise.then((unlisten) => unlisten());
    };
  }, []);
}
