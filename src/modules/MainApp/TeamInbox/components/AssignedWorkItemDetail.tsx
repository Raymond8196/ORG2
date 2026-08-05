import { ClipboardList, ExternalLink, Globe } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { WorkItemHandoffTransition } from "@src/api/http/project";
import { WorkItemThreadSurface } from "@src/modules/ProjectManager/WorkItems/components";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { Person } from "@src/types/core/shared";
import type { WorkItem } from "@src/types/core/workItem";
import { resolveGithubRepoFullName } from "@src/util/git/githubRemote";
import { openExternalLink } from "@src/util/platform/ipcRenderer";

import {
  type AssignedWorkItem,
  type TeamInboxNavigationIntent,
  isGitHubIssueStatus,
} from "../domain";
import { useTeamInboxWorkItem } from "../useTeamInboxWorkItem";
import type { TeamInboxWorkItemIssue } from "../useTeamInboxWorkItem";
import TeamInboxDetailLayout from "./TeamInboxDetailLayout";

export interface AssignedWorkItemDetailProps {
  item: AssignedWorkItem;
  onNavigate?: (intent: TeamInboxNavigationIntent) => void;
  onMarkRead?: (item: AssignedWorkItem) => void;
  onMarkUnread?: (item: AssignedWorkItem) => void;
  onWorkItemUpdated?: (workItem: WorkItem) => void;
}

function buildGitHubIssueUrl(item: AssignedWorkItem): string | null {
  if (!isGitHubIssueStatus(item.payload.status)) return null;
  const repository = item.target.repository;
  const repoFullName = repository
    ? resolveGithubRepoFullName([repository])
    : null;
  const issueNumber = item.target.workItemId.trim().replace(/^#/, "");
  if (!repoFullName || !/^\d+$/.test(issueNumber)) return null;
  return `https://github.com/${repoFullName}/issues/${issueNumber}`;
}

interface AssignedWorkItemThreadProps {
  item: AssignedWorkItem;
  workItem: WorkItem;
  repoPath: string | null;
  members: Person[];
  currentUser: Person | null;
  issueMessage: string | null;
  issueTone: "warning" | "error" | null;
  updateWorkItem: (updates: Partial<WorkItem>) => void;
  transitionHandoff: (
    transition: WorkItemHandoffTransition
  ) => Promise<WorkItem>;
  refreshWorkItem: () => void;
  onNavigate?: (intent: TeamInboxNavigationIntent) => void;
}

const AssignedWorkItemThread: React.FC<AssignedWorkItemThreadProps> = ({
  item,
  workItem,
  repoPath,
  members,
  currentUser,
  issueMessage,
  issueTone,
  updateWorkItem,
  transitionHandoff,
  refreshWorkItem,
  onNavigate,
}) => {
  const isGitHubIssue = isGitHubIssueStatus(item.payload.status);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {issueMessage ? (
        <div
          role="status"
          className={`absolute inset-x-0 top-0 z-30 border-b px-3 py-2 text-xs ${
            issueTone === "warning"
              ? "border-warning-3 bg-warning-6/10 text-warning-6"
              : "border-danger-3 bg-danger-1 text-danger-6"
          }`}
        >
          {issueMessage}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkItemThreadSurface
            workItem={workItem}
            propertyProps={{
              onUpdate: updateWorkItem,
              availableProjects: workItem.project ? [workItem.project] : [],
              availableMilestones: workItem.milestone
                ? [workItem.milestone]
                : [],
              availableLabels: workItem.labels ?? [],
              availableMembers: members,
              projectIconType: isGitHubIssue ? "github" : undefined,
              projectReadonly: true,
            }}
            onUpdateWorkItem={updateWorkItem}
            onUpdateWorkItemImmediate={updateWorkItem}
            onTransitionHandoff={transitionHandoff}
            teamMembers={members}
            currentUser={currentUser ?? undefined}
            repoPath={repoPath}
            projectSlug={item.target.projectId || null}
            shortId={item.target.workItemId}
            onStartAgent={
              onNavigate
                ? () =>
                    onNavigate({
                      kind: "open_work_item",
                      orgId: item.target.orgId,
                      projectId: item.target.projectId,
                      workItemId: item.target.workItemId,
                      action: "start_agent",
                    })
                : undefined
            }
            onOpenSession={
              onNavigate
                ? (sessionId) =>
                    onNavigate({
                      kind: "open_session",
                      sessionId,
                    })
                : undefined
            }
            onRefreshWorkflow={refreshWorkItem}
          />
        </div>
      </div>
    </div>
  );
};

const AssignedWorkItemDetail: React.FC<AssignedWorkItemDetailProps> = ({
  item,
  onNavigate,
  onMarkRead,
  onMarkUnread,
  onWorkItemUpdated,
}) => {
  const { t } = useTranslation();
  const {
    workItem,
    status,
    issue,
    repoPath,
    members,
    currentUser,
    updateWorkItem,
    transitionHandoff,
    refreshWorkItem,
  } = useTeamInboxWorkItem(
    item.target,
    onWorkItemUpdated,
    item.payload.updatedAt
  );
  const issueMessage = ((): string | null => {
    const keyByIssue: Record<TeamInboxWorkItemIssue, string> = {
      context_unavailable: "teamInbox.errors.workItemContext",
      load_failed: "teamInbox.errors.workItemLoad",
      update_failed: "teamInbox.errors.workItemUpdate",
    };
    return issue ? t(keyByIssue[issue]) : null;
  })();
  const githubIssueUrl = buildGitHubIssueUrl(item);

  return (
    <TeamInboxDetailLayout
      title={workItem?.name ?? item.payload.title}
      subtitle={t("teamInbox.detail.assignedSubtitle")}
      icon={ClipboardList}
      contentLayout="fill"
      unread={item.readAt === null}
      markReadLabel={t("teamInbox.actions.markRead")}
      markUnreadLabel={t("teamInbox.actions.markUnread")}
      openLabel={t(
        githubIssueUrl
          ? "previews.openInBrowser"
          : "teamInbox.actions.openWorkItem"
      )}
      openIcon={
        githubIssueUrl ? (
          <Globe size={14} strokeWidth={1.75} aria-hidden />
        ) : (
          <ExternalLink size={14} aria-hidden />
        )
      }
      openPlacement="header"
      onMarkRead={onMarkRead ? () => onMarkRead(item) : undefined}
      onMarkUnread={onMarkUnread ? () => onMarkUnread(item) : undefined}
      onOpen={
        githubIssueUrl
          ? () => void openExternalLink(githubIssueUrl)
          : onNavigate
            ? () =>
                onNavigate({
                  kind: "open_work_item",
                  orgId: item.target.orgId,
                  projectId: item.target.projectId,
                  workItemId: item.target.workItemId,
                })
            : undefined
      }
    >
      {status === "loading" ? (
        <Placeholder
          variant="loading"
          placement="detail-panel"
          title={t("teamInbox.loading")}
          fillParentHeight
        />
      ) : status === "ready" && workItem ? (
        <AssignedWorkItemThread
          item={item}
          workItem={workItem}
          repoPath={repoPath}
          members={members}
          currentUser={currentUser}
          issueMessage={issueMessage}
          issueTone={
            issue === "context_unavailable" ? "warning" : issue ? "error" : null
          }
          updateWorkItem={updateWorkItem}
          transitionHandoff={transitionHandoff}
          refreshWorkItem={refreshWorkItem}
          onNavigate={onNavigate}
        />
      ) : (
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={t("teamInbox.errors.loadTitle")}
          subtitle={issueMessage ?? t("teamInbox.errors.workItemLoad")}
          onRetry={refreshWorkItem}
          fillParentHeight
        />
      )}
    </TeamInboxDetailLayout>
  );
};

export default AssignedWorkItemDetail;
