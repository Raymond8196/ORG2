import { useAtomValue } from "jotai";
import React, { useCallback, useMemo, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import { useSessionCommentsContext } from "@src/features/Org2Cloud/SessionComments/SessionCommentsContext";
import {
  type ConversationFamilyMember,
  resolveConversationFamily,
  stitchConversationSegments,
} from "@src/features/Org2Cloud/SessionConversation/continuationEvents";
import {
  buildDiscussionEvents,
  mergeConversationEvents,
} from "@src/features/Org2Cloud/SessionConversation/discussionEvents";
import { useEnsureFamilyLoaded } from "@src/features/Org2Cloud/SessionConversation/useEnsureFamilyLoaded";
import { useMarkDiscussionSeen } from "@src/features/Org2Cloud/SessionConversation/useMarkDiscussionSeen";
import { usePinnedSession } from "@src/features/Org2Cloud/SessionConversation/usePinnedSession";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { org2CloudRemoteSessionsAtom } from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import { findImportedSession } from "@src/features/TeamCollaboration/engine/collabImportIdentity";
import { getSessionForkedFrom } from "@src/features/TeamCollaboration/forkSession";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";

import { ChatHistoryOverrideContext } from "./ChatHistoryOverrideContext";

interface ConversationStreamProviderProps {
  sessionId: string;
  chatEvents: SessionEvent[];
  /** Pre-merged group-chat stream; takes precedence over conversation merging. */
  overrideEvents: SessionEvent[] | undefined;
  children: React.ReactNode;
}

interface MemberEventsTapProps {
  bareSessionId: string;
  localSessionId: string;
  onEvents: (bareSessionId: string, events: SessionEvent[]) => void;
}

/** Invisible per-family-member subscription; the atom self-hydrates on mount. */
function MemberEventsTap({
  bareSessionId,
  localSessionId,
  onEvents,
}: MemberEventsTapProps): null {
  const events = useAtomValue(chatEventsForSessionAtomFamily(localSessionId));
  React.useEffect(() => {
    onEvents(bareSessionId, events);
  }, [bareSessionId, events, onEvents]);
  return null;
}

/**
 * Feeds ChatHistory the conversation stream: the fork family stitched into
 * one transcript (root first, continuations introduced by divider rows),
 * with the session's discussion rows (cloud comments) interleaved by
 * timestamp. Must render inside `SessionCommentsProvider`.
 */
export function ConversationStreamProvider({
  sessionId,
  chatEvents,
  overrideEvents,
  children,
}: ConversationStreamProviderProps): React.ReactElement {
  const comments = useSessionCommentsContext();
  const currentSession = usePinnedSession(sessionId);
  const remoteEntries = useAtomValue(org2CloudRemoteSessionsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const auth = useAtomValue(org2CloudAuthAtom);

  const target = comments?.target ?? null;
  const grouped = comments?.grouped ?? null;
  const toSourceEventId = comments?.toSourceEventId ?? null;
  const anchorBareSessionId =
    currentSession?.importedFrom?.sourceSessionId ?? sessionId;

  const family = useMemo(() => {
    if (!target || overrideEvents) return null;
    const rows = remoteEntries[target.orgId]?.rows;
    if (!rows?.length) return null;
    const resolved = resolveConversationFamily(rows, anchorBareSessionId);
    if (resolved) return resolved;
    // A just-created fork has no cloud row until its first push lands, so
    // the listing alone cannot place it in a family — and without a family
    // the inherited rows render unstamped ("Shared user"). Synthesize the
    // membership from the LOCAL lineage: the root's listing row plus a
    // pseudo-row for this session owned by the signed-in viewer.
    const lineage = currentSession
      ? getSessionForkedFrom(currentSession)
      : undefined;
    const rootSessionId = lineage?.rootSessionId ?? lineage?.sourceSessionId;
    if (!lineage || !rootSessionId || rootSessionId === anchorBareSessionId) {
      return null;
    }
    const rootFamily =
      resolveConversationFamily(rows, rootSessionId) ??
      (() => {
        const rootRow = rows.find(
          (row) => row.sourceSessionId === rootSessionId
        );
        return rootRow
          ? [{ bareSessionId: rootSessionId, row: rootRow, isRoot: true }]
          : null;
      })();
    if (!rootFamily) return null;
    if (
      rootFamily.some((member) => member.bareSessionId === anchorBareSessionId)
    ) {
      return rootFamily;
    }
    const selfMember: ConversationFamilyMember = {
      bareSessionId: anchorBareSessionId,
      isRoot: false,
      row: {
        id: `local-${anchorBareSessionId}`,
        orgId: target.orgId,
        sourceSessionId: anchorBareSessionId,
        ownerUserId: auth?.userId ?? "",
        ownerDisplayName: auth?.profile?.displayName ?? "",
        forkedFrom: {
          sourceSessionId: lineage.sourceSessionId,
          rootSessionId,
          forkedAt: lineage.forkedAt,
        },
      } as unknown as RemoteTeammateSessionMetadata,
    };
    return [...rootFamily, selfMember];
  }, [
    target,
    overrideEvents,
    remoteEntries,
    anchorBareSessionId,
    currentSession,
    auth?.userId,
    auth?.profile?.displayName,
  ]);

  useMarkDiscussionSeen(sessionId, comments, family);

  const memberTaps = useMemo(() => {
    if (!family || !target) return [];
    const taps: { bareSessionId: string; localSessionId: string }[] = [];
    for (const member of family) {
      if (member.bareSessionId === anchorBareSessionId) continue;
      const local =
        sessions.find(
          (session) => session.session_id === member.bareSessionId
        ) ??
        findImportedSession(
          sessions,
          target.orgId,
          member.bareSessionId,
          auth?.supabaseUrl
        );
      if (local) {
        taps.push({
          bareSessionId: member.bareSessionId,
          localSessionId: local.session_id,
        });
      }
    }
    return taps;
  }, [family, target, sessions, auth?.supabaseUrl, anchorBareSessionId]);

  const loadedBareSessionIds = useMemo(
    () => new Set(memberTaps.map((tap) => tap.bareSessionId)),
    [memberTaps]
  );
  useEnsureFamilyLoaded(family, loadedBareSessionIds, anchorBareSessionId);

  const [eventsByBareId, setEventsByBareId] = useState<
    ReadonlyMap<string, readonly SessionEvent[]>
  >(() => new Map());
  const handleMemberEvents = useCallback(
    (bareSessionId: string, events: SessionEvent[]) => {
      setEventsByBareId((previous) => {
        if (previous.get(bareSessionId) === events) return previous;
        const next = new Map(previous);
        next.set(bareSessionId, events);
        return next;
      });
    },
    []
  );

  const value = useMemo((): SessionEvent[] | undefined => {
    if (overrideEvents) return overrideEvents;
    const base = family
      ? stitchConversationSegments(
          family,
          anchorBareSessionId,
          chatEvents,
          eventsByBareId
        )
      : chatEvents;
    if (!grouped || !toSourceEventId) {
      return family ? base : undefined;
    }
    if (
      grouped.byEventId.size === 0 &&
      grouped.sessionLevel.length === 0 &&
      grouped.orphaned.length === 0
    ) {
      return family ? base : undefined;
    }
    const bySourceId = new Map<string, SessionEvent>();
    for (const event of chatEvents) {
      const sourceId = toSourceEventId(event.id);
      if (!bySourceId.has(sourceId)) bySourceId.set(sourceId, event);
    }
    const discussion = buildDiscussionEvents(grouped, sessionId, bySourceId);
    if (discussion.length === 0) {
      return family ? base : undefined;
    }
    return mergeConversationEvents(base, discussion);
  }, [
    overrideEvents,
    family,
    anchorBareSessionId,
    chatEvents,
    eventsByBareId,
    sessionId,
    grouped,
    toSourceEventId,
  ]);

  return (
    <>
      {memberTaps.map((tap) => (
        <MemberEventsTap
          key={tap.localSessionId}
          bareSessionId={tap.bareSessionId}
          localSessionId={tap.localSessionId}
          onEvents={handleMemberEvents}
        />
      ))}
      <ChatHistoryOverrideContext.Provider value={value}>
        {children}
      </ChatHistoryOverrideContext.Provider>
    </>
  );
}
