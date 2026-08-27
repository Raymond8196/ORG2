import Activity from "@hugeicons/core-free-icons/Activity01Icon";
import ArchiveRestore from "@hugeicons/core-free-icons/ArchiveArrowUpIcon";
import Archive from "@hugeicons/core-free-icons/ArchiveIcon";
import ArrowRightLeft from "@hugeicons/core-free-icons/ArrowLeftRightIcon";
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import CircleDot from "@hugeicons/core-free-icons/CircleIcon";
import CopyX from "@hugeicons/core-free-icons/Copy01Icon";
import CopyCheck from "@hugeicons/core-free-icons/Copy02Icon";
import Flag from "@hugeicons/core-free-icons/Flag01Icon";
import GitCommitHorizontal from "@hugeicons/core-free-icons/GitCommitIcon";
import GitCompareArrows from "@hugeicons/core-free-icons/GitCompareIcon";
import GitMerge from "@hugeicons/core-free-icons/GitMergeIcon";
import GitPullRequest from "@hugeicons/core-free-icons/GitPullRequestIcon";
import SquareKanban from "@hugeicons/core-free-icons/KanbanIcon";
import Link2 from "@hugeicons/core-free-icons/Link02Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import MessageSquare from "@hugeicons/core-free-icons/Message01Icon";
import MessagesSquare from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import Bell from "@hugeicons/core-free-icons/Notification01Icon";
import BellOff from "@hugeicons/core-free-icons/NotificationOff01Icon";
import Pencil from "@hugeicons/core-free-icons/Pen01Icon";
import Pin from "@hugeicons/core-free-icons/PinIcon";
import PinOff from "@hugeicons/core-free-icons/PinOffIcon";
import Rocket from "@hugeicons/core-free-icons/RocketIcon";
import ShieldBan from "@hugeicons/core-free-icons/SecurityBlockIcon";
import Unlock from "@hugeicons/core-free-icons/SquareUnlock01Icon";
import TagIcon from "@hugeicons/core-free-icons/Tag01Icon";
import Unlink2 from "@hugeicons/core-free-icons/Unlink02Icon";
import UserPlus from "@hugeicons/core-free-icons/UserAdd01Icon";
import UserMinus from "@hugeicons/core-free-icons/UserMinus01Icon";
import Eye from "@hugeicons/core-free-icons/ViewIcon";
import GitBranch from "@hugeicons/core-free-icons/WorkflowCircle05Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubIssueTimelineItem,
  GitHubIssueTimelineSource,
} from "@src/api/tauri/github";
import Tag from "@src/components/Tag";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import { getLabelColorStyle } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/workstationIssueHelpers";
import {
  ActivityTimestamp,
  TimelineEventCard,
} from "@src/modules/shared/components/ActivityTimeline";

const EVENT_ICON_PROPS = { size: 13, strokeWidth: 1.8 } as const;

const LOCALIZED_EVENT_DESCRIPTIONS: Record<
  string,
  readonly [key: string, defaultValue: string]
> = {
  comment_deleted: ["commentDeleted", "deleted a comment"],
  subscribed: ["subscribed", "subscribed to this issue"],
  unsubscribed: ["unsubscribed", "unsubscribed from this issue"],
  added_to_project: ["addedToProject", "added this issue to a project"],
  moved_columns_in_project: ["movedInProject", "moved this issue in a project"],
  removed_from_project: [
    "removedFromProject",
    "removed this issue from a project",
  ],
  archived: ["archived", "archived this issue"],
  unarchived: ["unarchived", "unarchived this issue"],
  merged: ["merged", "merged this pull request"],
  committed: ["committed", "committed to this pull request"],
  head_ref_deleted: ["headRefDeleted", "deleted the head branch"],
  head_ref_restored: ["headRefRestored", "restored the head branch"],
  head_ref_force_pushed: ["headRefForcePushed", "force-pushed the head branch"],
  base_ref_changed: ["baseRefChanged", "changed the base branch"],
  automatic_base_change_failed: [
    "automaticBaseChangeFailed",
    "could not automatically change the base branch",
  ],
  automatic_base_change_succeeded: [
    "automaticBaseChangeSucceeded",
    "automatically changed the base branch",
  ],
  deployed: ["deployed", "deployed this pull request"],
  deployment_environment_changed: [
    "deploymentEnvironmentChanged",
    "changed the deployment environment",
  ],
  ready_for_review: ["readyForReview", "marked this pull request ready"],
  review_requested: ["reviewRequested", "requested a review"],
  review_request_removed: ["reviewRequestRemoved", "removed a review request"],
  reviewed: ["reviewed", "reviewed these changes"],
  review_dismissed: ["reviewDismissed", "dismissed a review"],
  user_blocked: ["userBlocked", "blocked this user"],
};

function humanizeEventName(event: string): string {
  return event.replace(/[_-]/g, " ");
}

function getSourceStateClassName(state: string): string {
  if (state === "open") return "text-success-6";
  if (state === "closed") return "text-purple-6";
  return "text-text-3";
}

function TimelineEventIcon({ event }: { event: string }): React.ReactNode {
  switch (event) {
    case "assigned":
      return (
        <HugeiconsIcon
          icon={UserPlus}
          data-icon="user-plus"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unassigned":
      return (
        <HugeiconsIcon
          icon={UserMinus}
          data-icon="user-minus"
          {...EVENT_ICON_PROPS}
        />
      );
    case "labeled":
    case "unlabeled":
      return (
        <HugeiconsIcon
          icon={TagIcon}
          data-icon="tag-icon"
          {...EVENT_ICON_PROPS}
        />
      );
    case "milestoned":
    case "demilestoned":
      return (
        <HugeiconsIcon icon={Flag} data-icon="flag" {...EVENT_ICON_PROPS} />
      );
    case "closed":
      return (
        <HugeiconsIcon
          icon={CheckCircle2}
          data-icon="check-circle-2"
          {...EVENT_ICON_PROPS}
        />
      );
    case "reopened":
      return (
        <HugeiconsIcon
          icon={CircleDot}
          data-icon="circle-dot"
          {...EVENT_ICON_PROPS}
        />
      );
    case "renamed":
      return (
        <HugeiconsIcon icon={Pencil} data-icon="pencil" {...EVENT_ICON_PROPS} />
      );
    case "locked":
      return (
        <HugeiconsIcon icon={Lock} data-icon="lock" {...EVENT_ICON_PROPS} />
      );
    case "unlocked":
      return (
        <HugeiconsIcon icon={Unlock} data-icon="unlock" {...EVENT_ICON_PROPS} />
      );
    case "cross-referenced":
      return (
        <HugeiconsIcon
          icon={GitPullRequest}
          data-icon="git-pull-request"
          {...EVENT_ICON_PROPS}
        />
      );
    case "referenced":
      return (
        <HugeiconsIcon
          icon={GitCommitHorizontal}
          data-icon="git-commit-horizontal"
          {...EVENT_ICON_PROPS}
        />
      );
    case "connected":
      return (
        <HugeiconsIcon icon={Link2} data-icon="link-2" {...EVENT_ICON_PROPS} />
      );
    case "disconnected":
      return (
        <HugeiconsIcon
          icon={Unlink2}
          data-icon="unlink-2"
          {...EVENT_ICON_PROPS}
        />
      );
    case "pinned":
      return <HugeiconsIcon icon={Pin} data-icon="pin" {...EVENT_ICON_PROPS} />;
    case "unpinned":
      return (
        <HugeiconsIcon
          icon={PinOff}
          data-icon="pin-off"
          {...EVENT_ICON_PROPS}
        />
      );
    case "mentioned":
    case "commented":
    case "comment_deleted":
      return (
        <HugeiconsIcon
          icon={MessageSquare}
          data-icon="message-square"
          {...EVENT_ICON_PROPS}
        />
      );
    case "marked_as_duplicate":
      return (
        <HugeiconsIcon
          icon={CopyCheck}
          data-icon="copy-check"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unmarked_as_duplicate":
      return (
        <HugeiconsIcon icon={CopyX} data-icon="copy-x" {...EVENT_ICON_PROPS} />
      );
    case "transferred":
      return (
        <HugeiconsIcon
          icon={ArrowRightLeft}
          data-icon="arrow-right-left"
          {...EVENT_ICON_PROPS}
        />
      );
    case "converted_to_discussion":
      return (
        <HugeiconsIcon
          icon={MessagesSquare}
          data-icon="messages-square"
          {...EVENT_ICON_PROPS}
        />
      );
    case "subscribed":
      return (
        <HugeiconsIcon icon={Bell} data-icon="bell" {...EVENT_ICON_PROPS} />
      );
    case "unsubscribed":
      return (
        <HugeiconsIcon
          icon={BellOff}
          data-icon="bell-off"
          {...EVENT_ICON_PROPS}
        />
      );
    case "added_to_project":
    case "moved_columns_in_project":
    case "removed_from_project":
      return (
        <HugeiconsIcon
          icon={SquareKanban}
          data-icon="square-kanban"
          {...EVENT_ICON_PROPS}
        />
      );
    case "archived":
      return (
        <HugeiconsIcon
          icon={Archive}
          data-icon="archive"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unarchived":
      return (
        <HugeiconsIcon
          icon={ArchiveRestore}
          data-icon="archive-restore"
          {...EVENT_ICON_PROPS}
        />
      );
    case "merged":
      return (
        <HugeiconsIcon
          icon={GitMerge}
          data-icon="git-merge"
          {...EVENT_ICON_PROPS}
        />
      );
    case "committed":
      return (
        <HugeiconsIcon
          icon={GitCommitHorizontal}
          data-icon="git-commit-horizontal"
          {...EVENT_ICON_PROPS}
        />
      );
    case "head_ref_deleted":
    case "head_ref_restored":
    case "head_ref_force_pushed":
      return (
        <HugeiconsIcon
          icon={GitBranch}
          data-icon="git-branch"
          {...EVENT_ICON_PROPS}
        />
      );
    case "base_ref_changed":
    case "automatic_base_change_failed":
    case "automatic_base_change_succeeded":
      return (
        <HugeiconsIcon
          icon={GitCompareArrows}
          data-icon="git-compare-arrows"
          {...EVENT_ICON_PROPS}
        />
      );
    case "deployed":
    case "deployment_environment_changed":
      return (
        <HugeiconsIcon icon={Rocket} data-icon="rocket" {...EVENT_ICON_PROPS} />
      );
    case "ready_for_review":
    case "review_requested":
    case "review_request_removed":
    case "reviewed":
    case "review_dismissed":
      return <HugeiconsIcon icon={Eye} data-icon="eye" {...EVENT_ICON_PROPS} />;
    case "user_blocked":
      return (
        <HugeiconsIcon
          icon={ShieldBan}
          data-icon="shield-ban"
          {...EVENT_ICON_PROPS}
        />
      );
    default:
      return (
        <HugeiconsIcon
          icon={Activity}
          data-icon="activity"
          {...EVENT_ICON_PROPS}
        />
      );
  }
}

function TimelineUser({ login }: { login: string }): React.ReactNode {
  return (
    <span className="whitespace-nowrap font-medium text-text-1">{login}</span>
  );
}

function CrossReferenceLink({
  source,
}: {
  source: GitHubIssueTimelineSource;
}): React.ReactNode {
  return (
    <a
      href={source.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden align-middle font-medium text-primary-6 hover:underline"
      title={source.title}
    >
      {source.is_pull_request ? (
        <HugeiconsIcon
          icon={GitPullRequest}
          data-icon="git-pull-request"
          size={12}
          strokeWidth={1.8}
          className={`shrink-0 ${getSourceStateClassName(source.state)}`}
        />
      ) : (
        <HugeiconsIcon
          icon={CircleDot}
          data-icon="circle-dot"
          size={12}
          strokeWidth={1.8}
          className={`shrink-0 ${getSourceStateClassName(source.state)}`}
        />
      )}
      <span className="shrink-0">#{source.number}</span>
      <span className="min-w-0 truncate">{source.title}</span>
    </a>
  );
}

export function IssueTimelineEventDescription({
  item,
}: {
  item: GitHubIssueTimelineItem;
}): React.ReactNode {
  const { t } = useTranslation("common");

  switch (item.event) {
    case "assigned":
      return item.assignee ? (
        <>
          {t("git.issues.activity.assigned", "assigned")}{" "}
          <TimelineUser login={item.assignee.login} />
        </>
      ) : (
        <>{t("git.issues.activity.assignedIssue", "assigned this issue")}</>
      );
    case "unassigned":
      return item.assignee ? (
        <>
          {t("git.issues.activity.unassigned", "unassigned")}{" "}
          <TimelineUser login={item.assignee.login} />
        </>
      ) : (
        <>{t("git.issues.activity.removedAssignee", "removed an assignee")}</>
      );
    case "labeled":
    case "unlabeled":
      return (
        <>
          {item.event === "labeled"
            ? t("git.issues.activity.added", "added")
            : t("git.issues.activity.removed", "removed")}{" "}
          {item.label ? (
            <Tag
              size="mini"
              pill
              className={`${TYPOGRAPHY.badge} !px-1.5 !py-px align-middle !text-[10px] !leading-3`}
              style={getLabelColorStyle(item.label.color)}
            >
              {item.label.name}
            </Tag>
          ) : (
            t("git.issues.activity.label", "a label")
          )}
        </>
      );
    case "milestoned":
      return (
        <>
          {t("git.issues.activity.milestoned", {
            milestone: item.milestone ?? "",
            defaultValue: "added this issue to milestone {{milestone}}",
          })}
        </>
      );
    case "demilestoned":
      return (
        <>
          {t("git.issues.activity.demilestoned", {
            milestone: item.milestone ?? "",
            defaultValue: "removed this issue from milestone {{milestone}}",
          })}
        </>
      );
    case "closed":
      return item.commit_id ? (
        <>
          {t("git.issues.activity.closedViaCommit", {
            commit: item.commit_id.slice(0, 7),
            defaultValue: "closed this issue via commit {{commit}}",
          })}
        </>
      ) : (
        <>{t("git.issues.activity.closed", "closed this issue")}</>
      );
    case "reopened":
      return <>{t("git.issues.activity.reopened", "reopened this issue")}</>;
    case "renamed":
      return item.rename ? (
        <>
          {t("git.issues.activity.renamedTo", "renamed this issue to")}{" "}
          <q>{item.rename.to}</q>
        </>
      ) : (
        <>{t("git.issues.activity.renamed", "renamed this issue")}</>
      );
    case "locked":
      return item.lock_reason ? (
        <>
          {t("git.issues.activity.lockedAs", {
            reason: item.lock_reason,
            defaultValue: "locked this conversation as {{reason}}",
          })}
        </>
      ) : (
        <>{t("git.issues.activity.locked", "locked this conversation")}</>
      );
    case "unlocked":
      return (
        <>{t("git.issues.activity.unlocked", "unlocked this conversation")}</>
      );
    case "cross-referenced":
      return item.source ? (
        <>
          {t(
            "git.issues.activity.crossReferencedFrom",
            "referenced this issue from"
          )}{" "}
          <CrossReferenceLink source={item.source} />
        </>
      ) : (
        <>
          {t(
            "git.issues.activity.crossReferenced",
            "cross-referenced this issue"
          )}
        </>
      );
    case "referenced":
      return item.commit_id ? (
        <>
          {t("git.issues.activity.referencedInCommit", {
            commit: item.commit_id.slice(0, 7),
            defaultValue: "referenced this issue in commit {{commit}}",
          })}
        </>
      ) : (
        <>
          {t(
            "git.issues.activity.referencedInACommit",
            "referenced this issue in a commit"
          )}
        </>
      );
    case "connected":
      return <>{t("git.issues.activity.connected", "linked this issue")}</>;
    case "disconnected":
      return (
        <>{t("git.issues.activity.disconnected", "unlinked this issue")}</>
      );
    case "marked_as_duplicate":
      return (
        <>
          {t(
            "git.issues.activity.markedAsDuplicate",
            "marked this issue as a duplicate"
          )}
        </>
      );
    case "unmarked_as_duplicate":
      return (
        <>
          {t(
            "git.issues.activity.unmarkedAsDuplicate",
            "removed the duplicate marking"
          )}
        </>
      );
    case "pinned":
      return <>{t("git.issues.activity.pinned", "pinned this issue")}</>;
    case "unpinned":
      return <>{t("git.issues.activity.unpinned", "unpinned this issue")}</>;
    case "transferred":
      return (
        <>{t("git.issues.activity.transferred", "transferred this issue")}</>
      );
    case "converted_to_discussion":
      return (
        <>
          {t(
            "git.issues.activity.convertedToDiscussion",
            "converted this issue to a discussion"
          )}
        </>
      );
    case "mentioned":
      return <>{t("git.issues.activity.mentioned", "mentioned this issue")}</>;
    default: {
      const localizedEvent = LOCALIZED_EVENT_DESCRIPTIONS[item.event];
      if (localizedEvent) {
        const [key, defaultValue] = localizedEvent;
        return <>{t(`git.issues.activity.${key}`, defaultValue)}</>;
      }
      return <>{humanizeEventName(item.event)}</>;
    }
  }
}

export function IssueTimelineEventRow({
  item,
}: {
  item: GitHubIssueTimelineItem;
}): React.ReactNode {
  const actorName = item.actor?.login ?? "GitHub";

  return (
    <TimelineEventCard icon={<TimelineEventIcon event={item.event} />}>
      <>
        <span className="font-medium text-text-1">{actorName}</span>{" "}
        <IssueTimelineEventDescription item={item} />
        {item.created_at ? (
          <>
            <span className="mx-1">·</span>
            <ActivityTimestamp timestamp={item.created_at} />
          </>
        ) : null}
      </>
    </TimelineEventCard>
  );
}
