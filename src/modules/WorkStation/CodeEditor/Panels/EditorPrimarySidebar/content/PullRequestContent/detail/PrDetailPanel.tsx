/**
 * PrDetailPanel
 *
 * GitHub-style tabbed Pull Request detail rendered in the Source Control main
 * pane: a header (status pill · #number · title) over
 * a Conversation / Commits / Checks / Changes sub-tab bar.
 *
 * Mounts `useWorkstationPrDetail` (which parallel-fetches every source and
 * publishes into `workstationSelectedPrAtom`) and renders each tab from that
 * shared state. Reuses commit-history + issue-timeline formatting throughout.
 */
import { useAtom, useAtomValue } from "jotai";
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CircleUserRound,
  GitBranch,
  GitMerge,
  MessageCircle,
  SquareArrowOutUpRight,
} from "lucide-react";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubChecksSummary,
  GitHubPrReview,
  PrFile,
} from "@src/api/tauri/github";
import Avatar from "@src/components/Avatar";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { PanelHeader, Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  type PrDetailTab,
  type PrIdentity,
  workstationPrDetailTabAtomFamily,
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { useWorkstationPrDetail } from "../../../hooks/useWorkstationPrDetail";
import { PrChangesTab } from "./PrChangesTab";
import { PrChecksTab } from "./PrChecksTab";
import { PrCommitsTab } from "./PrCommitsTab";
import { PrConversationTab } from "./PrConversationTab";
import { PrDetailHeaderContent } from "./PrDetailHeaderContent";

export { PrDetailHeaderContent } from "./PrDetailHeaderContent";

interface PrDetailPanelProps {
  identity: PrIdentity;
  repoPath: string;
  repoId?: string;
  /** Optional host-owned actions rendered in the PR identity title row. */
  headerActions?: React.ReactNode;
  /**
   * Render the internal status·#number·title header row. Set false
   * when the host publishes this info elsewhere (e.g. the My Station PR tab
   * lifts it into the 40px tab-header strip via {@link PrDetailHeaderContent}).
   */
  showHeader?: boolean;
  onFileSelect?: (path: string) => void;
}

interface PrSummaryReviewer {
  login: string;
  avatarUrl: string;
}

function readNumber(
  detail: Record<string, unknown> | null,
  key: string
): number | null {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRequestedReviewers(
  detail: Record<string, unknown> | null
): PrSummaryReviewer[] {
  const value = detail?.requested_reviewers;
  if (!Array.isArray(value)) return [];
  return value.flatMap((reviewer) => {
    if (!reviewer || typeof reviewer !== "object") return [];
    const record = reviewer as Record<string, unknown>;
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

function collectReviewers(
  detail: Record<string, unknown> | null,
  reviews: GitHubPrReview[]
): PrSummaryReviewer[] {
  const unique = new Map<string, PrSummaryReviewer>();
  for (const reviewer of readRequestedReviewers(detail)) {
    unique.set(reviewer.login, reviewer);
  }
  for (const review of reviews) {
    if (!review.user.login) continue;
    unique.set(review.user.login, {
      login: review.user.login,
      avatarUrl: review.user.avatar_url,
    });
  }
  return [...unique.values()];
}

function checksLabel(
  checks: GitHubChecksSummary | null,
  t: (key: string, fallback: string) => string
): string {
  const count =
    (checks?.check_runs.length ?? 0) + (checks?.statuses.length ?? 0);
  if (count === 0) return t("git.pr.summary.noChecks", "No CI checks");
  if (checks?.state === "success") {
    return t("git.pr.checks.allPassed", "All checks passed");
  }
  if (checks?.state === "failure") {
    return t("git.pr.summary.checksFailed", "Checks failed");
  }
  return t("git.pr.checks.pending", "Checks in progress");
}

interface PrDetailSummaryProps {
  identity: PrIdentity;
  baseBranch: string;
  detail: Record<string, unknown> | null;
  conversationCount: number;
  reviews: GitHubPrReview[];
  files: PrFile[];
  checks: GitHubChecksSummary | null;
}

export function PrDetailSummary({
  identity,
  baseBranch,
  detail,
  conversationCount,
  reviews,
  files,
  checks,
}: PrDetailSummaryProps): React.ReactNode {
  const { t } = useTranslation("common");
  const reviewers = collectReviewers(detail, reviews);
  const additions =
    readNumber(detail, "additions") ??
    files.reduce((total, file) => total + file.additions, 0);
  const deletions =
    readNumber(detail, "deletions") ??
    files.reduce((total, file) => total + file.deletions, 0);
  const commentCount = readNumber(detail, "comments") ?? conversationCount;
  const statusLabel = t(`git.pr.status.${identity.status}`, identity.status);

  return (
    <section
      data-testid="pr-detail-summary"
      aria-label={t("git.pr.summary.label", "Pull request summary")}
    >
      <div
        className={`${DETAIL_PANEL_TOKENS.headerWidth} grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5 px-6 pt-4 text-[13px]`}
      >
        <div className="flex items-center gap-2 text-text-3">
          <GitBranch size={14} strokeWidth={1.75} />
          <span>{t("git.pr.summary.branch", "Branch")}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-text-1">
          <span className="max-w-full truncate" title={identity.headBranch}>
            {identity.headBranch}
          </span>
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-text-3"
          />
          <span className="shrink-0">{baseBranch}</span>
          <span className="shrink-0 tabular-nums text-success-6">
            +{additions.toLocaleString("en-US")}
          </span>
          <span className="shrink-0 tabular-nums text-danger-6">
            -{deletions.toLocaleString("en-US")}
          </span>
        </div>

        <div className="flex items-center gap-2 text-text-3">
          <CircleUserRound size={14} strokeWidth={1.75} />
          <span>{t("git.pr.summary.reviewers", "Reviewers")}</span>
        </div>
        <div className="flex min-h-5 min-w-0 items-center gap-1 text-text-1">
          {reviewers.length > 0 ? (
            <>
              {reviewers.slice(0, 5).map((reviewer) => (
                <span key={reviewer.login} title={reviewer.login}>
                  <Avatar size={20} src={reviewer.avatarUrl} />
                </span>
              ))}
              {reviewers.length > 5 ? (
                <span className="text-[11px] text-text-3">
                  +{reviewers.length - 5}
                </span>
              ) : null}
            </>
          ) : (
            <span>{t("git.pr.summary.noReviewers", "No reviewers")}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-text-3">
          <MessageCircle size={14} strokeWidth={1.75} />
          <span>{t("git.pr.summary.comments", "Comments")}</span>
        </div>
        <div className="text-text-1">
          {t("git.pr.summary.commentCount", {
            count: commentCount,
            defaultValue: "{{count}} comment",
            defaultValue_other: "{{count}} comments",
          })}
        </div>

        <div className="flex items-center gap-2 text-text-3">
          <CheckCircle2 size={14} strokeWidth={1.75} />
          <span>{t("git.pr.summary.checks", "Checks")}</span>
        </div>
        <div className="text-text-1">{checksLabel(checks, t)}</div>

        <div className="flex items-center gap-2 text-text-3">
          {identity.status === "merged" ? (
            <GitMerge size={14} strokeWidth={1.75} />
          ) : (
            <CircleDot size={14} strokeWidth={1.75} />
          )}
          <span>{t("git.pr.summary.status", "Status")}</span>
        </div>
        <div className="capitalize text-text-1">{statusLabel}</div>
      </div>
    </section>
  );
}

export const PrDetailPanel: React.FC<PrDetailPanelProps> = ({
  identity,
  repoPath,
  repoId,
  headerActions,
  showHeader = true,
  onFileSelect,
}) => {
  const { t } = useTranslation("common");
  const scopeKey = workstationPrScopeKey(repoId, repoPath, identity.number);
  const state = useAtomValue(workstationSelectedPrAtomFamily(scopeKey));
  const [activeTab, setActiveTab] = useAtom(
    workstationPrDetailTabAtomFamily(scopeKey)
  );

  const { repoFullName, addComment, submitReview, replyInlineComment } =
    useWorkstationPrDetail({
      repoPath,
      repoId,
      pr: identity,
    });

  // Reset to Conversation when switching to a different PR.
  useEffect(() => {
    setActiveTab("conversation");
  }, [identity.number, setActiveTab]);

  const baseBranch =
    state.baseRef ?? identity.baseBranch ?? t("git.pr.baseBranch", "base");

  const tabs: TabPillItem[] = useMemo(
    () => [
      {
        key: "conversation",
        label: t("git.pr.tabs.conversation", "Conversation"),
        badge:
          state.conversation.length + state.reviews.length > 0 ? (
            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-text-2">
              {state.conversation.length + state.reviews.length}
            </span>
          ) : undefined,
      },
      {
        key: "changes",
        label: t("git.pr.tabs.changes", "Changes"),
        badge:
          state.files.length > 0 ? (
            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-text-2">
              {state.files.length}
            </span>
          ) : undefined,
      },
      {
        key: "commits",
        label: t("git.pr.tabs.commits", "Commits"),
        badge:
          state.commits.length > 0 ? (
            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-text-2">
              {state.commits.length}
            </span>
          ) : undefined,
      },
      {
        key: "checks",
        label: t("git.pr.tabs.checks", "Checks"),
      },
    ],
    [
      t,
      state.conversation.length,
      state.reviews.length,
      state.commits.length,
      state.files.length,
    ]
  );

  if (state.loading) {
    return (
      <Placeholder
        variant="loading"
        placement="detail-panel"
        fillParentHeight
      />
    );
  }

  return (
    <div className="allow-select-deep flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      {showHeader ? (
        <PanelHeader
          borderBottom
          className={DETAIL_PANEL_TOKENS.headerPadding}
          dataTestId="pr-detail-header"
          actions={headerActions}
        >
          <PrDetailHeaderContent identity={identity} />
        </PanelHeader>
      ) : null}

      {/* Sub-tab bar */}
      <div className="flex shrink-0 items-center gap-1 py-1 pl-3 pr-2">
        <TabPill
          tabs={tabs}
          activeTab={activeTab}
          onChange={(key) => setActiveTab(key as PrDetailTab)}
          variant="pill"
          color="fill"
          fillWidth={false}
          size="small"
        />
        <a
          href={identity.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
          aria-label={t("actions.openOnGitHub", "Open on GitHub")}
          title={t("actions.openOnGitHub", "Open on GitHub")}
        >
          <SquareArrowOutUpRight size={14} strokeWidth={2} />
        </a>
      </div>

      {/* Error banner */}
      {state.error ? (
        <div className="text-danger-7 shrink-0 border-b border-border-1 bg-danger-1 px-4 py-1.5 text-[11px]">
          {state.error}
        </div>
      ) : null}

      {/* Active tab */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "conversation" && (
          <PrConversationTab
            summary={
              <PrDetailSummary
                identity={identity}
                baseBranch={baseBranch}
                detail={state.detail}
                conversationCount={state.conversation.length}
                reviews={state.reviews}
                files={state.files}
                checks={state.checks}
              />
            }
            detail={state.detail}
            identity={identity}
            conversation={state.conversation}
            reviews={state.reviews}
            reviewComments={state.reviewComments}
            loading={state.loading}
            submittingComment={state.submittingComment}
            submittingReview={state.submittingReview}
            onAddComment={addComment}
            onSubmitReview={submitReview}
          />
        )}
        {activeTab === "commits" && (
          <PrCommitsTab
            commits={state.commits}
            prNumber={identity.number}
            repoPath={repoPath}
            repoId={repoId}
            loading={state.loading}
            onFileSelect={onFileSelect}
          />
        )}
        {activeTab === "checks" && (
          <PrChecksTab checks={state.checks} loading={state.loading} />
        )}
        {activeTab === "changes" && (
          <PrChangesTab
            repoFullName={repoFullName}
            detail={state.detail}
            headSha={state.headSha}
            baseRef={state.baseRef}
            files={state.files}
            loading={state.loading}
            reviewComments={state.reviewComments}
            onFileSelect={onFileSelect}
            onReplyInlineComment={replyInlineComment}
          />
        )}
      </div>
    </div>
  );
};

PrDetailPanel.displayName = "PrDetailPanel";
