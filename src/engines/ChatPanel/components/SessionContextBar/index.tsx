/**
 * SessionContextBar
 *
 * Thin read-only header bar showing the session's repo and branch context.
 * Shown at the top of an active session's chat when the session has a
 * `repoPath`. When the session runs in a worktree, the worktree branch is
 * displayed as a static badge — the runner is locked at the agent-core
 * layer once the worktree is created and cannot be switched in the UI.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { FolderKanban, GitFork, Monitor } from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useChannelWorkItem } from "@src/features/DiscussionChannels/ChannelPanelView/useChannelWorkItem";
import { getWorkItemStatusConfig } from "@src/modules/ProjectManager/config/manage";
import { openWorkItemInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import type { WorkItemStatus } from "@src/types/core/workItem";
import { formatBranchLabel } from "@src/util/git/branchLabel";
import { basename } from "@src/util/path";

// ── Sub-components ────────────────────────────────────────────────────────────

interface BarPillProps {
  label: string;
  icon?: React.ReactNode;
  dimmed?: boolean;
}

const BarPill: React.FC<BarPillProps> = ({ label, icon, dimmed }) => (
  <span
    className={`inline-flex h-[22px] max-w-[160px] items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium transition-colors ${
      dimmed ? "text-text-3" : "text-text-2"
    }`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </span>
);

interface WorktreePillProps {
  branch: string;
}

// WorktreePill is display-only: once a session has a persisted worktreePath,
// the agent-core layer has already isolated the process and the runner cannot
// be switched back. We show the branch name as a static badge with a tooltip
// rather than a fake dropdown that pretends to offer a choice.
const WorktreePill: React.FC<WorktreePillProps> = ({ branch }) => {
  const { t } = useTranslation("sessions");

  return (
    <span
      title={t("creator.contextBar.lockedHint")}
      className="inline-flex h-[22px] max-w-[200px] items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium text-primary-6"
    >
      <GitFork size={11} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
};

interface ActiveWorkItemPillProps {
  shortId: string;
  projectSlug?: string;
}

// Active WorkItem indicator for Project sessions (orgtrack/v1 §7.2):
// shortId + live status, click opens the real Work Item panel. Items
// without a project scope (session-bootstrap standalone roots) render
// as a static badge — there is no project surface to open for them yet.
const ActiveWorkItemPill: React.FC<ActiveWorkItemPillProps> = ({
  shortId,
  projectSlug,
}) => {
  const openWorkItem = useSetAtom(openWorkItemInChatPanelTabAtom);
  const { resolved } = useChannelWorkItem({
    projectSlug: projectSlug ?? "",
    shortId,
  });

  const status = resolved?.workItem.status;
  const statusLabel = status
    ? getWorkItemStatusConfig(status as WorkItemStatus).label
    : null;

  const handleOpen = useCallback(() => {
    if (!resolved || !projectSlug) return;
    openWorkItem({
      workItem: resolved.workItem,
      shortId: resolved.workItem.shortId ?? shortId,
      projectId: resolved.projectId,
      projectSlug,
      projectName: resolved.projectName,
      orgId: resolved.orgId,
    });
  }, [openWorkItem, projectSlug, resolved, shortId]);

  const body = (
    <>
      <FolderKanban size={11} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{shortId}</span>
      {statusLabel && (
        <span className="truncate text-text-3">· {statusLabel}</span>
      )}
    </>
  );

  if (!projectSlug || !resolved) {
    return (
      <span
        data-testid="session-active-work-item-pill"
        className="inline-flex h-[22px] max-w-[240px] items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium text-primary-6"
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="session-active-work-item-pill"
      onClick={handleOpen}
      className="inline-flex h-[22px] max-w-[240px] items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium text-primary-6 transition-colors hover:bg-fill-1"
    >
      {body}
    </button>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const SessionContextBar: React.FC = memo(() => {
  const { sessionId } = useSessionId();
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));

  const repoPath = session?.repoPath;
  const worktreePath = session?.worktreePath;
  const worktreeBranch = session?.worktreeBranch;
  const sessionBranch = session?.branch;
  const baseBranch = session?.baseBranch;
  // Project sessions surface their active WorkItem here even without a
  // repo context (e.g. an OS-agent Home session tracked as a project).
  const workItemId =
    session?.productMode === "project" ? session?.workItemId : undefined;

  if (!sessionId || (!repoPath && !workItemId)) return null;

  const repoLabel = repoPath ? basename(repoPath) : null;
  const branchLabel =
    formatBranchLabel(sessionBranch) || formatBranchLabel(baseBranch);
  const worktreeLabel = formatBranchLabel(worktreeBranch);

  return (
    <div className="flex h-[32px] shrink-0 items-center gap-0.5 border-b border-border-1 px-3">
      {/* Repo name */}
      {repoLabel && (
        <BarPill
          label={repoLabel}
          icon={
            <Monitor
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-text-3"
            />
          }
        />
      )}

      {/* Separator */}
      {repoLabel && (branchLabel || worktreeLabel) && (
        <span className="mx-0.5 text-[11px] text-text-4">/</span>
      )}

      {/* Base branch */}
      {repoLabel && branchLabel && !worktreeLabel && (
        <BarPill label={branchLabel} dimmed />
      )}

      {/* Worktree pill (interactive) */}
      {worktreePath && worktreeLabel && <WorktreePill branch={worktreeLabel} />}

      {/* Active WorkItem (Project sessions) */}
      {workItemId && (
        <>
          <span className="mx-0.5 text-[11px] text-text-4">·</span>
          <ActiveWorkItemPill
            shortId={workItemId}
            projectSlug={session?.projectSlug ?? undefined}
          />
        </>
      )}
    </div>
  );
});

SessionContextBar.displayName = "SessionContextBar";

export default SessionContextBar;
