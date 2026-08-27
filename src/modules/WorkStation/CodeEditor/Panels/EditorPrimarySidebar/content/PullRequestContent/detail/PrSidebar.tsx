/**
 * PrSidebar
 *
 * GitHub-style operations rail for the PR detail panel: Reviewers (with the
 * working request-reviewers picker), read-only Assignees and Labels, and the
 * pull-request level operations (merge / auto-merge / draft / close) stacked
 * full-width like GitHub's right sidebar. Rendered on the Workstation trail
 * surface with the shared trail header + section formatting so it matches the
 * Work Item properties rail. The host mounts it beside the detail tabs, or
 * stacks it under the flow title when the pane is too narrow for two columns.
 */
import { Check, MessageCircle, Settings, XCircle } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubChecksSummary,
  GitHubIssueUser,
  GitHubPrReview,
  PullRequestMergeMethod,
} from "@src/api/tauri/github";
import Avatar from "@src/components/Avatar";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { WORKSTATION_TRAIL_CONTENT } from "@src/config/workstation/tokens";
import {
  WorkstationTrailBody,
  WorkstationTrailEmptyText,
  WorkstationTrailHeader,
  WorkstationTrailSection,
  WorkstationTrailSurface,
} from "@src/modules/shared/layouts/blocks";
import {
  presentPullRequestActions,
  readRequestedReviewers,
} from "@src/shared/pr/prLevelActions";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { PrLevelActions, reportPrAction } from "./PrLevelActions";

// ── Detail payload readers ───────────────────────────────────────────────────

interface PrSidebarUser {
  login: string;
  avatarUrl: string;
}

interface PrSidebarLabel {
  name: string;
  color: string;
}

function readUserList(
  detail: Record<string, unknown> | null,
  key: string
): PrSidebarUser[] {
  const value = detail?.[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.login !== "string" || !record.login) return [];
    return [
      {
        login: record.login,
        avatarUrl:
          typeof record.avatar_url === "string" ? record.avatar_url : "",
      },
    ];
  });
}

function readLabels(detail: Record<string, unknown> | null): PrSidebarLabel[] {
  const value = detail?.labels;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name) return [];
    return [
      {
        name: record.name,
        color: typeof record.color === "string" ? record.color : "",
      },
    ];
  });
}

// ── Reviewer state rollup ────────────────────────────────────────────────────

type ReviewerState =
  | "awaiting"
  | "approved"
  | "changes_requested"
  | "commented";

interface ReviewerEntry extends PrSidebarUser {
  state: ReviewerState;
}

function isDecisive(state: string): boolean {
  return state === "APPROVED" || state === "CHANGES_REQUESTED";
}

/**
 * Latest meaningful review state per user: an approval or change request wins
 * over comment-only reviews (matching GitHub's sidebar), and a pending
 * re-request overrides any previous review state.
 */
function collectReviewerEntries(
  detail: Record<string, unknown> | null,
  reviews: GitHubPrReview[]
): ReviewerEntry[] {
  const latest = new Map<string, GitHubPrReview>();
  for (const review of reviews) {
    const login = review.user.login;
    if (!login || review.state === "PENDING") continue;
    const previous = latest.get(login);
    const newer =
      !previous || (review.submitted_at ?? "") >= (previous.submitted_at ?? "");
    if (!previous) {
      latest.set(login, review);
    } else if (isDecisive(review.state)) {
      if (!isDecisive(previous.state) || newer) latest.set(login, review);
    } else if (!isDecisive(previous.state) && newer) {
      latest.set(login, review);
    }
  }

  const entries = new Map<string, ReviewerEntry>();
  for (const [login, review] of latest) {
    entries.set(login, {
      login,
      avatarUrl: review.user.avatar_url,
      state:
        review.state === "APPROVED"
          ? "approved"
          : review.state === "CHANGES_REQUESTED"
            ? "changes_requested"
            : "commented",
    });
  }
  for (const reviewer of readRequestedReviewers(detail)) {
    entries.set(reviewer.login, {
      login: reviewer.login,
      avatarUrl: reviewer.avatar_url,
      state: "awaiting",
    });
  }
  return [...entries.values()];
}

function ReviewerStateIndicator({
  state,
}: {
  state: ReviewerState;
}): React.ReactNode {
  const { t } = useTranslation("common");
  switch (state) {
    case "approved":
      return (
        <span
          title={t("git.pr.activity.approved", "approved these changes")}
          className="inline-flex"
        >
          <Check size={14} strokeWidth={2} className="text-success-6" />
        </span>
      );
    case "changes_requested":
      return (
        <span
          title={t("git.pr.activity.changesRequested", "requested changes")}
          className="inline-flex"
        >
          <XCircle size={14} strokeWidth={1.9} className="text-danger-6" />
        </span>
      );
    case "awaiting":
      return (
        <span
          title={t("git.pr.sidebar.awaitingReview", "Awaiting review")}
          className="inline-flex h-2 w-2 rounded-full bg-warning-6"
        />
      );
    default:
      return (
        <span
          title={t("git.pr.activity.commented", "commented")}
          className="inline-flex"
        >
          <MessageCircle size={14} strokeWidth={1.9} className="text-text-3" />
        </span>
      );
  }
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

interface PrSidebarProps {
  identity: PrIdentity;
  detail: Record<string, unknown> | null;
  checks: GitHubChecksSummary | null;
  reviews: GitHubPrReview[];
  disabled: boolean;
  pending: boolean;
  reviewerCandidates: GitHubIssueUser[];
  loadingReviewerCandidates: boolean;
  reviewerCandidatesError: string | null;
  onLoadReviewerCandidates: () => Promise<void>;
  onMerge: (method: PullRequestMergeMethod) => Promise<void>;
  onSetAutoMerge: (
    enabled: boolean,
    method: PullRequestMergeMethod
  ) => Promise<void>;
  onDraftChange: (draft: boolean) => Promise<void>;
  onStateChange: (state: "open" | "closed") => Promise<void>;
  onRequestedReviewersChange: (reviewers: string[]) => Promise<void>;
}

export const PrSidebar: React.FC<PrSidebarProps> = ({
  identity,
  detail,
  checks,
  reviews,
  disabled,
  pending,
  reviewerCandidates,
  loadingReviewerCandidates,
  reviewerCandidatesError,
  onLoadReviewerCandidates,
  onMerge,
  onSetAutoMerge,
  onDraftChange,
  onStateChange,
  onRequestedReviewersChange,
}) => {
  const { t } = useTranslation("common");
  const [reviewerMenuVisible, setReviewerMenuVisible] = useState(false);
  const presentation = presentPullRequestActions({
    detail,
    fallbackStatus: identity.status,
    checks,
  });
  const requestedReviewers = useMemo(
    () => readRequestedReviewers(detail),
    [detail]
  );
  const requestedReviewerLogins = requestedReviewers.map(
    (reviewer) => reviewer.login
  );
  const reviewerEntries = useMemo(
    () => collectReviewerEntries(detail, reviews),
    [detail, reviews]
  );
  const assignees = readUserList(detail, "assignees");
  const labels = readLabels(detail);

  const reviewerOptions = useMemo(() => {
    const unique = new Map<string, GitHubIssueUser>();
    for (const reviewer of [...requestedReviewers, ...reviewerCandidates]) {
      unique.set(reviewer.login.toLowerCase(), reviewer);
    }
    return [...unique.values()].map((reviewer) => ({
      value: reviewer.login,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size={18} src={reviewer.avatar_url}>
            {reviewer.login.charAt(0).toUpperCase()}
          </Avatar>
          <span className="truncate">{reviewer.login}</span>
        </span>
      ),
      triggerLabel: reviewer.login,
    }));
  }, [requestedReviewers, reviewerCandidates]);

  const canManageReviewers = presentation.status === "open" && !disabled;

  const reviewerAction = canManageReviewers ? (
    <Dropdown
      options={reviewerOptions}
      value={requestedReviewerLogins}
      mode="multiple"
      showSearch
      searchPlaceholder={t(
        "git.pr.actions.searchReviewers",
        "Search reviewers"
      )}
      loading={loadingReviewerCandidates}
      emptyContent={
        reviewerCandidatesError
          ? t("git.pr.actions.reviewersLoadFailed", "Could not load reviewers")
          : t("git.pr.actions.noReviewers", "No reviewers available")
      }
      disabled={pending}
      popupVisible={reviewerMenuVisible}
      onVisibleChange={(visible) => {
        setReviewerMenuVisible(visible);
        if (visible) void onLoadReviewerCandidates();
      }}
      getPopupContainer={() => document.body}
      avoidViewportOverflow
      className={`${DROPDOWN_CLASSES.panelAnimated} ${DROPDOWN_WIDTHS.fileTreeClass}`}
      onSelect={(value) => {
        const next = Array.isArray(value) ? value.map(String) : [String(value)];
        setReviewerMenuVisible(false);
        void reportPrAction(
          () => onRequestedReviewersChange(next),
          t("git.pr.actions.reviewersUpdated", "Reviewers updated")
        );
      }}
    >
      <Button
        htmlType="button"
        variant="tertiary"
        size="mini"
        shape="circle"
        iconOnly
        icon={<Settings size={13} strokeWidth={1.75} aria-hidden />}
        disabled={pending}
        aria-label={t("git.pr.sidebar.requestReviewers", "Request reviewers")}
        title={t("git.pr.sidebar.requestReviewers", "Request reviewers")}
        className="hover:!bg-surface-selected"
        data-testid="pr-reviewer-action"
      />
    </Dropdown>
  ) : undefined;

  return (
    <WorkstationTrailSurface
      className="flex self-start"
      data-testid="pr-sidebar"
    >
      <WorkstationTrailHeader title={t("git.pr.details", "Details")} />
      <WorkstationTrailBody
        className={`${WORKSTATION_TRAIL_CONTENT.sectionList} pb-1`}
      >
        <WorkstationTrailSection
          title={t("git.pr.sidebar.reviewers", "Reviewers")}
          action={reviewerAction}
          dataTestId="pr-sidebar-reviewers"
        >
          {reviewerEntries.length > 0 ? (
            <ul className={WORKSTATION_TRAIL_CONTENT.rows}>
              {reviewerEntries.map((entry) => (
                <li
                  key={entry.login}
                  className={`${WORKSTATION_TRAIL_CONTENT.row} justify-between gap-2 pr-2`}
                >
                  <span
                    className={WORKSTATION_TRAIL_CONTENT.rowContent}
                    title={entry.login}
                  >
                    <Avatar size={18} src={entry.avatarUrl}>
                      {entry.login.charAt(0).toUpperCase()}
                    </Avatar>
                    <span className="truncate text-text-1">{entry.login}</span>
                  </span>
                  <ReviewerStateIndicator state={entry.state} />
                </li>
              ))}
            </ul>
          ) : (
            <WorkstationTrailEmptyText>
              {t("git.pr.sidebar.noReviews", "No reviews")}
            </WorkstationTrailEmptyText>
          )}
        </WorkstationTrailSection>

        <WorkstationTrailSection
          title={t("git.pr.sidebar.assignees", "Assignees")}
          dataTestId="pr-sidebar-assignees"
        >
          {assignees.length > 0 ? (
            <ul className={WORKSTATION_TRAIL_CONTENT.rows}>
              {assignees.map((assignee) => (
                <li
                  key={assignee.login}
                  className={WORKSTATION_TRAIL_CONTENT.row}
                >
                  <span
                    className={WORKSTATION_TRAIL_CONTENT.rowContent}
                    title={assignee.login}
                  >
                    <Avatar size={18} src={assignee.avatarUrl}>
                      {assignee.login.charAt(0).toUpperCase()}
                    </Avatar>
                    <span className="truncate text-text-1">
                      {assignee.login}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <WorkstationTrailEmptyText>
              {t("git.pr.sidebar.noAssignees", "No one assigned")}
            </WorkstationTrailEmptyText>
          )}
        </WorkstationTrailSection>

        <WorkstationTrailSection
          title={t("git.pr.sidebar.labels", "Labels")}
          dataTestId="pr-sidebar-labels"
        >
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-2">
              {labels.map((label) => (
                <span
                  key={label.name}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-2 px-2 py-0.5 text-[11px] text-text-1"
                  title={label.name}
                >
                  {label.color ? (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `#${label.color}` }}
                    />
                  ) : null}
                  <span className="truncate">{label.name}</span>
                </span>
              ))}
            </div>
          ) : (
            <WorkstationTrailEmptyText>
              {t("git.pr.sidebar.noLabels", "None yet")}
            </WorkstationTrailEmptyText>
          )}
        </WorkstationTrailSection>

        <WorkstationTrailSection
          title={t("git.pr.sidebar.actions", "Actions")}
          dataTestId="pr-sidebar-actions"
        >
          <div className="px-1 pb-0.5">
            <PrLevelActions
              identity={identity}
              detail={detail}
              checks={checks}
              disabled={disabled}
              pending={pending}
              onMerge={onMerge}
              onSetAutoMerge={onSetAutoMerge}
              onDraftChange={onDraftChange}
              onStateChange={onStateChange}
            />
          </div>
        </WorkstationTrailSection>
      </WorkstationTrailBody>
    </WorkstationTrailSurface>
  );
};

PrSidebar.displayName = "PrSidebar";
