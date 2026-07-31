/**
 * A session referenced by a posted channel message, rendered as a card.
 *
 * Visual grammar follows the Kanban `TaskCard` — agent icon + title row, then
 * a footer meta strip — but the card is built here rather than imported:
 * `TaskCard` carries board behaviour (drag, column moves, selection accent,
 * priority/labels) that a transcript row has no use for. What IS reused is
 * the data side: `sessionToKanbanTask` projects the session exactly as the
 * board sees it (title with pill references stripped, agent identity, model,
 * tokens, workspace), so a channel card can never disagree with the board
 * about a session.
 *
 * The status dot is deliberately NOT derived from the board column: it runs
 * the sidebar's derivation (`resolveSessionStatusDotTone` + the breathing
 * marker for in-progress work) so one session shows the same dot in the
 * sidebar row and on the card.
 *
 * Round count comes from `useSessionTurnOverview`, the same derivation the
 * session hover card uses. That hook keeps a module-level cache keyed by
 * session id plus in-flight coalescing, so N cards naming one session share a
 * single load and a re-mount inside the virtualized transcript is free — no
 * extra memoization is needed at this layer.
 *
 * Live status reads `sessionByIdAtom`, never `sessionsAtom`: one card must
 * not re-render every time any session in the app changes.
 */
import { useAtomValue } from "jotai";
import { ChevronRight, FolderGit2, Repeat } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useSessionTurnOverview } from "@src/components/SessionHoverCard/useSessionTurnOverview";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { sessionToKanbanTask } from "@src/features/TaskKanban/hooks/useKanbanTasks/sessionToKanbanTask";
import {
  renderBreathingStatusDot,
  renderStatusDot,
} from "@src/scaffold/NavigationSidebar/connectors/useSessionMenuItems/statusIndicators";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { visitedSessionsAtom } from "@src/store/session/visitedSessionsAtom";
import { formatModelNameFull } from "@src/util/formatModelName";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";
import {
  isSessionPendingAsking,
  resolveSessionStatusDotTone,
} from "@src/util/session/sessionStatusDot";

/**
 * The projection takes archive inputs a transcript card has no opinion on: a
 * referenced session is never "archived" just because the board would shelve
 * it. `never` disables the TTL rule, which in turn makes `nowMs` unread — so
 * it is pinned to 0 rather than reaching for the clock during render.
 */
const NO_SESSION_IDS: ReadonlySet<string> = new Set<string>();
const NO_AUTO_ARCHIVE_NOW_MS = 0;

export interface ChannelSessionCardProps {
  sessionId: string;
  /** Title as posted — the only thing left when the session is gone. */
  fallbackTitle: string;
  onOpen: (sessionId: string) => void;
}

/** Cards sit inside the 900px transcript column but read as attachments, not
 *  full-width blocks, so they stop well short of the message text. */
const SESSION_CARD_MAX_WIDTH = "max-w-[600px]";

/**
 * Resolved outside the component, the way `TaskCard.renderAgentIcon` does it:
 * `resolveAgentIcon` returns a component type, and producing one during a
 * component's render remounts the subtree on every pass.
 */
function renderAgentIcon(iconId: string | undefined) {
  const AgentIcon = resolveAgentIcon(iconId);
  return <AgentIcon size={12} strokeWidth={1.75} />;
}

const MetaItem: React.FC<{
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, children }) => (
  <span className="inline-flex min-w-0 items-center gap-1">
    {icon}
    <span className="truncate">{children}</span>
  </span>
);

const ChannelSessionCard: React.FC<ChannelSessionCardProps> = ({
  sessionId,
  fallbackTitle,
  onOpen,
}) => {
  const { t } = useTranslation("navigation");
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const visitedSessions = useAtomValue(visitedSessionsAtom);
  const turnOverview = useSessionTurnOverview(sessionId);

  const task = useMemo(
    () =>
      session
        ? sessionToKanbanTask(
            session,
            NO_SESSION_IDS,
            NO_SESSION_IDS,
            "never",
            NO_AUTO_ARCHIVE_NOW_MS
          )
        : null,
    [session]
  );

  // A reference outlives the session it names — an imported history that was
  // cleared, another device's session. Say so instead of rendering a husk.
  if (!session || !task) {
    return (
      <div
        className={`mt-1.5 flex w-full flex-col gap-0.5 rounded-lg border border-dashed border-border-2 p-3 ${SESSION_CARD_MAX_WIDTH}`}
        data-testid="channel-session-card"
        data-session-id={sessionId}
        data-session-missing="true"
      >
        <span className="truncate text-[13px] font-medium text-text-3">
          {fallbackTitle}
        </span>
        <span className="text-[11px] text-text-4">
          {t("cloud.channels.feed.sessionCardMissing")}
        </span>
      </div>
    );
  }

  const inProgress = isSessionInProgress(session.status, session);
  const pendingAsking = isSessionPendingAsking(session);
  const roundCount = turnOverview?.turnCount ?? 0;

  return (
    <button
      type="button"
      className={`mt-1.5 flex w-full items-center gap-2 rounded-lg border border-border-2 p-3 text-left transition-colors hover:bg-fill-1 ${SESSION_CARD_MAX_WIDTH}`}
      data-testid="channel-session-card"
      data-session-id={sessionId}
      aria-label={t("cloud.channels.feed.sessionCardOpen", {
        name: task.title,
      })}
      onClick={() => onOpen(sessionId)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center text-text-1">
            {renderAgentIcon(task.agentIconId ?? task.cliAgentType)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">
            {task.title}
          </span>
          <span className="inline-flex shrink-0 items-center">
            {inProgress && !pendingAsking
              ? renderBreathingStatusDot()
              : renderStatusDot(
                  resolveSessionStatusDotTone(session, visitedSessions)
                )}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-3">
          {task.modelName ? (
            <MetaItem>{formatModelNameFull(task.modelName)}</MetaItem>
          ) : null}
          {roundCount > 0 ? (
            <MetaItem
              icon={<Repeat size={11} strokeWidth={1.75} aria-hidden />}
            >
              {t("sessions:history.detail.roundCount", { count: roundCount })}
            </MetaItem>
          ) : null}
          {task.workspaceName ? (
            <MetaItem
              icon={<FolderGit2 size={11} strokeWidth={1.75} aria-hidden />}
            >
              {task.workspaceName}
            </MetaItem>
          ) : null}
        </div>
      </div>
      <ChevronRight size={14} className="shrink-0 text-text-3" aria-hidden />
    </button>
  );
};

export default ChannelSessionCard;
