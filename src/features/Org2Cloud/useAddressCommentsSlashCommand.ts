/** Slash-menu bridge: an "Address comments" entry that fires the in-place address round on the active owned cloud session. */
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { useUserIntentSubmit } from "@src/engines/ChatPanel/hooks/useWorkspaceChat/useUserIntentSubmit";
import { getSessionForkedFrom } from "@src/features/TeamCollaboration/forkSession";
import { createLogger } from "@src/hooks/logger";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { SlashItem } from "@src/types/extensions";

import { collectAddressableThreads } from "./addressComments";
import type { AddressCommentScope } from "./addressComments";
import { runAddressCommentsRound } from "./addressCommentsRun";
import { sessionCommentsKey } from "./org2CloudCommentsBus";
import { org2CloudSessionCommentsAtom } from "./org2CloudSessionCommentsAtom";
import { useSessionCommentTarget } from "./sessionCommentTarget";

const log = createLogger("AddressCommentsSlashCommand");

export const ADDRESS_COMMENTS_SLASH_SOURCE = "org2cloud-address-comments";

export interface AddressCommentsThreadOption {
  id: string;
  author: string;
  body: string;
  scope: AddressCommentScope;
}

export interface AddressCommentsRunOptions {
  selectedHeadIds?: readonly string[];
  instruction?: string;
}

export interface AddressCommentsSlashCommand {
  item: SlashItem | null;
  available: boolean;
  threads: AddressCommentsThreadOption[];
  run: (options?: AddressCommentsRunOptions) => void;
}

export function useAddressCommentsSlashCommand(
  sessionId: string | null | undefined
): AddressCommentsSlashCommand {
  const { t } = useTranslation("navigation");
  const sessions = useAtomValue(sessionsAtom);
  const commentEntries = useAtomValue(org2CloudSessionCommentsAtom);
  const submitUserIntent = useUserIntentSubmit({
    getSessionId: () => sessionId ?? null,
  });

  const session = useMemo(
    () =>
      sessionId
        ? (sessions.find((candidate) => candidate.session_id === sessionId) ??
          null)
        : null,
    [sessions, sessionId]
  );
  const target = useSessionCommentTarget(session);
  const commentEntry = target
    ? commentEntries[sessionCommentsKey(target.orgId, target.sessionId)]
    : undefined;

  const threads = useMemo<AddressCommentsThreadOption[]>(() => {
    if (!target) return [];
    const entry = commentEntry;
    if (!entry) return [];
    return collectAddressableThreads(entry.comments).map((thread) => ({
      id: thread.headId,
      author: thread.headAuthor,
      body: thread.headBody,
      scope: thread.scope,
    }));
  }, [target, commentEntry]);

  const available = Boolean(
    session &&
    !session.importedFrom &&
    !getSessionForkedFrom(session) &&
    session.session_id === target?.sessionId &&
    commentEntry?.viewerOwnsSession &&
    threads.length > 0
  );

  const item = useMemo<SlashItem | null>(
    () =>
      available
        ? {
            name: t("cloud.comments.addressButton"),
            description: "",
            category: "action",
            source: ADDRESS_COMMENTS_SLASH_SOURCE,
            acceptsArgs: true,
          }
        : null,
    [available, t]
  );

  const run = useCallback(
    (options?: AddressCommentsRunOptions) => {
      if (!target || !session) return;
      void runAddressCommentsRound({
        orgId: target.orgId,
        cloudSessionId: target.sessionId,
        localSessionId: session.session_id,
        dispatchTurn: ({ displayContent, agentContent, turnIntentId }) =>
          submitUserIntent({
            sessionId: session.session_id,
            displayContent,
            agentContent,
            turnIntentId,
          }),
        ...(options?.selectedHeadIds !== undefined
          ? { selectedHeadIds: options.selectedHeadIds }
          : {}),
        ...(options?.instruction !== undefined
          ? { instruction: options.instruction }
          : {}),
      }).catch((error) => {
        log.warn("address-comments slash run failed:", error);
        Message.error(t("cloud.comments.actionError"));
      });
    },
    [target, session, submitUserIntent, t]
  );

  return { item, available, threads, run };
}
