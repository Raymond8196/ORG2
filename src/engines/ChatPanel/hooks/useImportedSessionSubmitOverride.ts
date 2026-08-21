import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { waitForSessionChannelReady } from "@src/engines/SessionCore/sync/useSessionChannel";
import {
  type ConversationFamilyMember,
  resolveConversationFamily,
} from "@src/features/Org2Cloud/SessionConversation/continuationEvents";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { org2CloudRemoteSessionsAtom } from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import { findImportedSession } from "@src/features/TeamCollaboration/engine/collabImportIdentity";
import { getSessionForkedFrom } from "@src/features/TeamCollaboration/forkSession";
import type { ForkImportedErrorKind } from "@src/features/TeamCollaboration/useForkImportedSession";
import { useForkImportedSession } from "@src/features/TeamCollaboration/useForkImportedSession";
import { createLogger } from "@src/hooks/logger";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import type { Session } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";
import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";
import type { SessionContinuation } from "@src/store/session/sessionTabPlacementAtom";

import type { SubmitOverrideInput } from "./useInputArea/types";
import { useUserIntentSubmit } from "./useWorkspaceChat/useUserIntentSubmit";

const logger = createLogger("ChatView");

const IMPORTED_FORK_ERROR_KEYS: Record<
  Exclude<ForkImportedErrorKind, "cancelled">,
  string
> = {
  retention: "collaboration.forkImported.retentionError",
  gone: "collaboration.forkImported.goneError",
  replay: "collaboration.forkImported.replayError",
  snapshot: "collaboration.forkImported.snapshotError",
  agent: "collaboration.forkImported.agentError",
  backend: "collaboration.forkImported.backendError",
  generic: "collaboration.forkImported.error",
};

interface UseImportedSessionSubmitOverrideOptions {
  sessionId: string;
  currentSession: Session | undefined;
  onFallbackSubmit: (input: SubmitOverrideInput) => Promise<boolean>;
  onSessionContinuation?: (continuation: SessionContinuation) => void;
}

/**
 * Intercepts the first send from an imported teammate session and routes it
 * through the fork flow. Ordinary sessions continue through the supplied
 * Agent-Org/group-chat submit handler unchanged.
 */
function memberActivity(member: ConversationFamilyMember): number {
  const parsed = Date.parse(member.row.lastActivityAt ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function useImportedSessionSubmitOverride({
  sessionId,
  currentSession,
  onFallbackSubmit,
  onSessionContinuation,
}: UseImportedSessionSubmitOverrideOptions): (
  input: SubmitOverrideInput
) => Promise<boolean> {
  const { t } = useTranslation("navigation");
  const { openSession } = useSessionView();
  const setRestoreToInput = useSetAtom(restoreToInputAtom);
  const remoteEntries = useAtomValue(org2CloudRemoteSessionsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const auth = useAtomValue(org2CloudAuthAtom);

  // TIP-FOLLOW: a conversation continues at its NEWEST family member no
  // matter which member's surface the send comes from. Without this, a send
  // from an older member forks a SIBLING branch — the reply would ignore
  // everything said since, which is never what "keep chatting" means.
  const lineage = currentSession
    ? getSessionForkedFrom(currentSession)
    : undefined;
  const familyOrgId =
    currentSession?.importedFrom?.orgId ?? lineage?.orgId ?? null;
  const anchorBareSessionId =
    currentSession?.importedFrom?.sourceSessionId ?? sessionId;
  const familyTip = useMemo(() => {
    if (!familyOrgId) return null;
    const rows = remoteEntries[familyOrgId]?.rows;
    if (!rows?.length) return null;
    const family = resolveConversationFamily(rows, anchorBareSessionId);
    if (!family) return null;
    const live = family.filter(
      (member) =>
        !member.row.deletedAt &&
        member.row.eventsEpoch !== undefined &&
        (member.row.eventsCount ?? 0) > 0
    );
    if (live.length === 0) return null;
    const tip = live.reduce((best, member) =>
      memberActivity(member) > memberActivity(best) ? member : best
    );
    return tip.bareSessionId === anchorBareSessionId ? null : tip;
  }, [familyOrgId, remoteEntries, anchorBareSessionId]);
  /** The tip session when it lives on THIS device as a writable session. */
  const ownLocalTip = useMemo(() => {
    if (!familyTip) return null;
    return (
      sessions.find(
        (candidate) => candidate.session_id === familyTip.bareSessionId
      ) ?? null
    );
  }, [familyTip, sessions]);
  /** The tip's imported replay copy — fork source when the tip is remote. */
  const tipImportedCopy = useMemo(() => {
    if (!familyTip || ownLocalTip || !familyOrgId) return null;
    const copy = findImportedSession(
      sessions,
      familyOrgId,
      familyTip.bareSessionId,
      auth?.supabaseUrl
    );
    return copy?.importedFrom ? copy : null;
  }, [familyTip, ownLocalTip, familyOrgId, sessions, auth?.supabaseUrl]);

  const { fork: forkImportedSession } = useForkImportedSession(
    tipImportedCopy ?? currentSession ?? null
  );
  const forkSubmitInFlightRef = useRef(false);
  // useUserIntentSubmit reads this target so the synthetic user event and
  // dispatch both land in the fork, not the still-mounted imported session.
  const forkDispatchSessionIdRef = useRef<string | null>(null);
  const submitIntoForkedSession = useUserIntentSubmit({
    getSessionId: () => forkDispatchSessionIdRef.current,
  });

  const restorePendingDraft = useCallback(
    (pending: SubmitOverrideInput, targetSessionId: string) => {
      setRestoreToInput({
        sessionId: targetSessionId,
        displayContent: pending.displayText,
        imageDataUrls: pending.imageDataUrls,
      });
    },
    [setRestoreToInput]
  );

  return useCallback(
    async (input: SubmitOverrideInput): Promise<boolean> => {
      // The tip already lives here as a writable session (typically the
      // viewer's own earlier continuation): no new fork — the send goes
      // straight into it, and the surface follows. This is what keeps a
      // back-and-forth conversation ONE conversation instead of a fork
      // per round.
      if (ownLocalTip) {
        if (forkSubmitInFlightRef.current) {
          restorePendingDraft(input, sessionId);
          return true;
        }
        forkSubmitInFlightRef.current = true;
        try {
          forkDispatchSessionIdRef.current = ownLocalTip.session_id;
          const continuation = {
            sessionId: ownLocalTip.session_id,
            sessionName: ownLocalTip.name,
            repoPath: ownLocalTip.repoPath,
          };
          if (onSessionContinuation) {
            onSessionContinuation(continuation);
          } else {
            openSession(
              continuation.sessionId,
              continuation.sessionName,
              continuation.repoPath
            );
          }
          try {
            await waitForSessionChannelReady(ownLocalTip.session_id);
            await submitIntoForkedSession({
              sessionId: ownLocalTip.session_id,
              displayContent: input.displayText,
              agentContent: input.agentContent,
              imageDataUrls: input.imageDataUrls,
            });
          } catch (error) {
            logger.error("failed to send into the conversation tip", error);
            restorePendingDraft(input, ownLocalTip.session_id);
            Message.error(t("collaboration.forkImported.sendFailed"));
          } finally {
            forkDispatchSessionIdRef.current = null;
          }
          return true;
        } finally {
          forkSubmitInFlightRef.current = false;
        }
      }
      // Remote tip (or no family): fork before send. `forkImportedSession`
      // is bound to the tip's imported copy when the family has moved past
      // this surface, so the continuation inherits the WHOLE conversation.
      if (!currentSession?.importedFrom && !tipImportedCopy) {
        return onFallbackSubmit(input);
      }
      if (forkSubmitInFlightRef.current) {
        // A picker/fork is already in flight. Keep a second submission as
        // the imported draft rather than replacing the captured first send.
        restorePendingDraft(input, sessionId);
        return true;
      }

      forkSubmitInFlightRef.current = true;
      try {
        const outcome = await forkImportedSession();
        if (!outcome.ok) {
          restorePendingDraft(input, sessionId);
          if (outcome.errorKind !== "cancelled") {
            Message.error(t(IMPORTED_FORK_ERROR_KEYS[outcome.errorKind]));
          }
          return true;
        }

        forkDispatchSessionIdRef.current = outcome.localSessionId;
        if (onSessionContinuation) {
          onSessionContinuation({
            sessionId: outcome.localSessionId,
            sessionName: outcome.name,
            repoPath: outcome.repoPath,
          });
        } else {
          openSession(outcome.localSessionId, outcome.name, outcome.repoPath);
        }
        try {
          // The first turn can finish before the new IPC channel is mounted.
          // Wait for readiness so agent:complete cannot be lost.
          await waitForSessionChannelReady(outcome.localSessionId);
          await submitIntoForkedSession({
            sessionId: outcome.localSessionId,
            displayContent: input.displayText,
            agentContent: input.agentContent,
            imageDataUrls: input.imageDataUrls,
          });
        } catch (error) {
          logger.error("failed to send captured message into fork", error);
          restorePendingDraft(input, outcome.localSessionId);
          Message.error(t("collaboration.forkImported.sendFailed"));
        } finally {
          forkDispatchSessionIdRef.current = null;
        }
      } finally {
        forkSubmitInFlightRef.current = false;
      }
      return true;
    },
    [
      currentSession?.importedFrom,
      forkImportedSession,
      onFallbackSubmit,
      onSessionContinuation,
      openSession,
      ownLocalTip,
      restorePendingDraft,
      sessionId,
      submitIntoForkedSession,
      t,
      tipImportedCopy,
    ]
  );
}
