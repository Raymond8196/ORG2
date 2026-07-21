import { CheckCircle2, CircleDot, GitPullRequest } from "lucide-react";
import React, { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import IntegrationIcon from "@src/components/IntegrationIcon";
import { SearchInput } from "@src/components/SearchInput";
import type { SelectOption } from "@src/components/Select";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import {
  IssueDetailHeaderContent,
  IssueDetailPanel,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import {
  DetailPanelContainer,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import {
  CreateIssueModal,
  ManagedIssueRow,
  ManagedPrRow,
  RepoFilterPill,
} from "./GitHubWorkItemControls";
import {
  GitHubWorkItemListFrame,
  GitHubWorkItemPagination,
  GitHubWorkItemSummary,
  GitHubWorkItemToolbarActions,
} from "./GitHubWorkItemList";
import {
  GITHUB_ITEM_KIND,
  GITHUB_QUERY_SCOPE,
  GITHUB_QUERY_STATE,
  type GitHubQueryScope,
  type GitHubRepoSource,
  type IssueRepoFilter,
  type ManagedGitHubItem,
  type ManagedIssueItem,
  type ManagedPrItem,
  type ParsedGitHubSearchQuery,
  type RepoFilterOption,
} from "./githubWorkItemsModel";
import { canAdvanceGitHubWorkItemsPage } from "./githubWorkItemsPagination";
import type { IssueDetailState } from "./useGitHubIssueDetail";

interface GitHubWorkItemsViewProps {
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  loading: boolean;
  loadError: string | null;
  loadingMore: boolean;
  allItemsCount: number;
  filteredItems: ManagedGitHubItem[];
  pagedItems: ManagedGitHubItem[];
  repoSources: GitHubRepoSource[];
  repoOptions: RepoFilterOption[];
  effectiveSelectedRepo: IssueRepoFilter;
  selectedRepoSourceForCreate: GitHubRepoSource | null;
  searchQuery: string;
  parsedSearchQuery: ParsedGitHubSearchQuery;
  issuePersonalFilterOptions: SelectOption[];
  selectedIssuePersonalFilters: string[];
  issueStateCounts: { open: number; closed: number };
  openIssuesLoaded: boolean;
  closedIssuesLoaded: boolean;
  openPrCount: number;
  closedPrCount: number;
  openPrLoaded: boolean;
  closedPrLoaded: boolean;
  currentPage: number;
  totalLoadedPages: number;
  hasMoreFilteredIssues: boolean;
  createFormOpen: boolean;
  creatingIssue: boolean;
  issueDetail: IssueDetailState | null;
  updateSearchQuery: (mutate: (query: ParsedGitHubSearchQuery) => void) => void;
  onSearchQueryChange: (query: string) => void;
  onRepoSelect: (repo: IssueRepoFilter) => void;
  onIssuePersonalFiltersSelect: (values: (string | number)[]) => void;
  onRefresh: () => void;
  onPreviousPage: () => void;
  onNextPage: () => Promise<void>;
  onOpenIssue: (issue: ManagedIssueItem) => void;
  onOpenIssueInBrowser: (issue: ManagedIssueItem) => void;
  onOpenIssueInMyStation: (issue: ManagedIssueItem) => void;
  onAddIssue: (issue: ManagedIssueItem) => void;
  onOpenPr: (pr: ManagedPrItem) => void;
  onAddPr: (pr: ManagedPrItem) => void;
  onBackFromDetail: () => void;
  onCloseIssueDetail: () => Promise<void>;
  onReopenIssueDetail: () => Promise<void>;
  onAddIssueDetailComment: (body: string) => Promise<void>;
  onSetCreateFormOpen: (open: boolean) => void;
  onCreateIssue: (
    source: GitHubRepoSource,
    title: string,
    body: string
  ) => void;
}

export function GitHubWorkItemsView({
  scope,
  loading,
  loadError,
  loadingMore,
  allItemsCount,
  filteredItems,
  pagedItems,
  repoSources,
  repoOptions,
  effectiveSelectedRepo,
  selectedRepoSourceForCreate,
  searchQuery,
  parsedSearchQuery,
  issuePersonalFilterOptions,
  selectedIssuePersonalFilters,
  issueStateCounts,
  openIssuesLoaded,
  closedIssuesLoaded,
  openPrCount,
  closedPrCount,
  openPrLoaded,
  closedPrLoaded,
  currentPage,
  totalLoadedPages,
  hasMoreFilteredIssues,
  createFormOpen,
  creatingIssue,
  issueDetail,
  updateSearchQuery,
  onSearchQueryChange,
  onRepoSelect,
  onIssuePersonalFiltersSelect,
  onRefresh,
  onPreviousPage,
  onNextPage,
  onOpenIssue,
  onOpenIssueInBrowser,
  onOpenIssueInMyStation,
  onAddIssue,
  onOpenPr,
  onAddPr,
  onBackFromDetail,
  onCloseIssueDetail,
  onReopenIssueDetail,
  onAddIssueDetailComment,
  onSetCreateFormOpen,
  onCreateIssue,
}: GitHubWorkItemsViewProps): React.ReactNode {
  const { t } = useTranslation(["sessions", "common"]);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const headerContent = useMemo(
    () =>
      issueDetail ? (
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-text-1">
          <IssueDetailHeaderContent issue={issueDetail.issue} />
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IntegrationIcon
            type="github"
            size={HEADER_ICON_SIZE.sm}
            className="shrink-0"
          />
          <RepoFilterPill
            options={repoOptions}
            selectedRepo={effectiveSelectedRepo}
            allReposLabel={t("chat.manageIssues.allRepositories")}
            onSelectRepo={onRepoSelect}
          />
          <SearchInput
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t("chat.panels.manageIssues.searchPlaceholder")}
            ariaLabel={t("chat.panels.manageIssues.searchPlaceholder")}
            variant="panel"
            surface="transparent"
            hideChevron
            showClearButton
            inputBoxClassName="flex-1"
            className="min-w-0 flex-1"
          />
        </div>
      ),
    [
      effectiveSelectedRepo,
      issueDetail,
      onRepoSelect,
      onSearchQueryChange,
      repoOptions,
      searchQuery,
      t,
    ]
  );
  const headerTrailing = useMemo(
    () =>
      issueDetail ? null : (
        <GitHubWorkItemToolbarActions
          openHref={
            selectedRepoSourceForCreate
              ? `https://github.com/${selectedRepoSourceForCreate.repoFullName}`
              : null
          }
          openLabel={t("chat.panels.manageIssues.openInGitHub")}
          refreshLabel={t("common:actions.refresh")}
          refreshing={loading}
          createAction={
            scope === GITHUB_QUERY_SCOPE.ISSUE
              ? {
                  label: t("chat.panels.manageIssues.createIssueTrigger"),
                  disabled: repoSources.length === 0,
                  onClick: () => onSetCreateFormOpen(true),
                }
              : undefined
          }
          onRefresh={onRefresh}
        />
      ),
    [
      issueDetail,
      loading,
      onRefresh,
      onSetCreateFormOpen,
      repoSources.length,
      scope,
      selectedRepoSourceForCreate,
      t,
    ]
  );
  const headerContribution = useMemo(
    () => ({ content: headerContent, trailing: headerTrailing }),
    [headerContent, headerTrailing]
  );
  usePublishWorkstationTabHeader({
    host: "workManagement",
    content: headerContribution,
  });

  const handlePreviousPage = () => {
    onPreviousPage();
    listScrollRef.current?.scrollTo({ top: 0 });
  };

  const handleNextPage = async () => {
    await onNextPage();
    listScrollRef.current?.scrollTo({ top: 0 });
  };

  const listContent = (() => {
    if (
      scope !== GITHUB_QUERY_SCOPE.PR &&
      loading &&
      filteredItems.length === 0
    ) {
      return (
        <Placeholder
          variant="loading"
          placement="detail-panel"
          fillParentHeight
        />
      );
    }

    if (loadError && allItemsCount === 0) {
      return (
        <Placeholder
          variant="error"
          subtitle={loadError}
          action={{ label: t("common:actions.retry"), onClick: onRefresh }}
          fillParentHeight
        />
      );
    }

    if (!loading && repoSources.length === 0) {
      return <Placeholder variant="empty" fillParentHeight />;
    }

    if (
      scope !== GITHUB_QUERY_SCOPE.PR &&
      !loading &&
      filteredItems.length === 0
    ) {
      return <Placeholder variant="no-results" fillParentHeight />;
    }

    const summary = (
      <GitHubWorkItemSummary
        tabs={
          scope === GITHUB_QUERY_SCOPE.ISSUE
            ? [
                {
                  key: GITHUB_QUERY_STATE.OPEN,
                  label: t("chat.panels.manageIssues.stateOpen"),
                  count: openIssuesLoaded ? issueStateCounts.open : null,
                  icon: <CircleDot size={13} strokeWidth={1.8} />,
                  active: parsedSearchQuery.state === GITHUB_QUERY_STATE.OPEN,
                  onSelect: () =>
                    updateSearchQuery((query) => {
                      query.state = GITHUB_QUERY_STATE.OPEN;
                    }),
                },
                {
                  key: GITHUB_QUERY_STATE.CLOSED,
                  label: t("chat.panels.manageIssues.stateClosed"),
                  count: closedIssuesLoaded ? issueStateCounts.closed : null,
                  icon: <CheckCircle2 size={13} strokeWidth={1.8} />,
                  active: parsedSearchQuery.state === GITHUB_QUERY_STATE.CLOSED,
                  onSelect: () =>
                    updateSearchQuery((query) => {
                      query.state = GITHUB_QUERY_STATE.CLOSED;
                    }),
                },
              ]
            : [
                {
                  key: GITHUB_QUERY_STATE.OPEN,
                  label: t("chat.panels.manageIssues.stateOpen"),
                  count: openPrLoaded ? openPrCount : null,
                  icon: <GitPullRequest size={13} strokeWidth={1.8} />,
                  active:
                    parsedSearchQuery.state === null ||
                    parsedSearchQuery.state === GITHUB_QUERY_STATE.OPEN,
                  onSelect: () =>
                    updateSearchQuery((query) => {
                      query.state = GITHUB_QUERY_STATE.OPEN;
                    }),
                },
                {
                  key: GITHUB_QUERY_STATE.CLOSED,
                  label: t("chat.panels.manageIssues.stateClosed"),
                  count: closedPrLoaded ? closedPrCount : null,
                  icon: <CheckCircle2 size={13} strokeWidth={1.8} />,
                  active:
                    parsedSearchQuery.state === GITHUB_QUERY_STATE.CLOSED ||
                    parsedSearchQuery.state === GITHUB_QUERY_STATE.MERGED,
                  onSelect: () =>
                    updateSearchQuery((query) => {
                      query.state = GITHUB_QUERY_STATE.CLOSED;
                    }),
                },
              ]
        }
        actions={
          scope === GITHUB_QUERY_SCOPE.ISSUE ? (
            <Dropdown
              options={issuePersonalFilterOptions}
              value={selectedIssuePersonalFilters}
              mode="multiple"
              position="bottom-end"
              onSelect={(value) =>
                onIssuePersonalFiltersSelect(
                  Array.isArray(value) ? value : [value]
                )
              }
            >
              <Button
                htmlType="button"
                variant="secondary"
                appearance="outline"
                size="small"
              >
                {t("common:actions.filter")}
                {selectedIssuePersonalFilters.length > 0
                  ? ` (${selectedIssuePersonalFilters.length})`
                  : ""}
              </Button>
            </Dropdown>
          ) : undefined
        }
      />
    );

    return (
      <GitHubWorkItemListFrame
        summary={summary}
        height={
          scope === GITHUB_QUERY_SCOPE.PR && filteredItems.length === 0
            ? 180
            : undefined
        }
      >
        {scope === GITHUB_QUERY_SCOPE.PR && filteredItems.length === 0 ? (
          <Placeholder
            variant={loading ? "loading" : loadError ? "error" : "no-results"}
            subtitle={loadError ?? undefined}
            action={
              loadError
                ? {
                    label: t("common:actions.retry"),
                    onClick: onRefresh,
                  }
                : undefined
            }
            fillParentHeight
          />
        ) : (
          // Keep paginated rows in normal document flow. Their wrapped titles
          // and metadata have dynamic heights, and native WebView zoom can put
          // virtualizer measurements in a different coordinate space.
          pagedItems.map((item, index) => {
            return (
              <div
                key={`${item.kind}-${item.repo}-${item.id}`}
                className={`w-full ${
                  index < pagedItems.length - 1
                    ? "border-b border-border-2"
                    : ""
                }`}
              >
                {item.kind === GITHUB_ITEM_KIND.ISSUE ? (
                  <ManagedIssueRow
                    issue={item}
                    addLabel={t("chat.panels.manageIssues.addToChat")}
                    openInBrowserLabel={t("common:previews.openInBrowser")}
                    openInMyStationLabel={t("layout.sidebar.openInMyStation")}
                    moreActionsLabel={t("common:actions.moreActions")}
                    onOpenIssue={onOpenIssue}
                    onOpenIssueInBrowser={onOpenIssueInBrowser}
                    onOpenIssueInMyStation={onOpenIssueInMyStation}
                    onAddIssue={onAddIssue}
                  />
                ) : (
                  <ManagedPrRow
                    pr={item}
                    addLabel={t("chat.panels.manageIssues.addToChat")}
                    onOpenPr={onOpenPr}
                    onAddPr={onAddPr}
                  />
                )}
              </div>
            );
          })
        )}
      </GitHubWorkItemListFrame>
    );
  })();

  const issueDetailContent = issueDetail ? (
    <IssueDetailPanel
      issue={issueDetail.issue}
      comments={issueDetail.comments}
      commentsLoading={issueDetail.commentsLoading}
      submittingComment={issueDetail.submittingComment}
      showHeader={false}
      contentPadding="default"
      onClose={onBackFromDetail}
      onCloseIssue={onCloseIssueDetail}
      onReopenIssue={onReopenIssueDetail}
      onAddComment={onAddIssueDetailComment}
    />
  ) : null;

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="work-management-github"
    >
      <DetailPanelContainer testId="work-management-github-panel">
        <section
          className="flex min-h-0 flex-1"
          data-testid={`work-management-github-${scope}`}
        >
          <CreateIssueModal
            open={createFormOpen}
            repoSources={repoSources}
            selectedRepo={selectedRepoSourceForCreate}
            creating={creatingIssue}
            labels={{
              title: t("chat.panels.manageIssues.newIssueTitle"),
              issueTitlePlaceholder: t(
                "chat.panels.manageIssues.issueTitlePlaceholder"
              ),
              issueBodyPlaceholder: t(
                "chat.panels.manageIssues.issueBodyPlaceholder"
              ),
              repository: t("chat.panels.manageIssues.repositoryLabel"),
              cancel: t("common:actions.cancel"),
              create: t("chat.panels.manageIssues.createIssue"),
              creating: t("chat.panels.manageIssues.creatingIssue"),
            }}
            onCreateIssue={onCreateIssue}
            onCancel={() => onSetCreateFormOpen(false)}
          />
          <div className="bg-bg-0 flex min-w-0 flex-1 flex-col">
            {issueDetailContent ?? (
              <>
                <div
                  ref={listScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-hide"
                >
                  {listContent}
                </div>
                {filteredItems.length > 0 ? (
                  <GitHubWorkItemPagination
                    totalLabel={t("common:pagination.pageOf", {
                      current: currentPage,
                      total: hasMoreFilteredIssues
                        ? `${totalLoadedPages}+`
                        : totalLoadedPages,
                    })}
                    previousLabel={t("common:actions.previous")}
                    nextLabel={t("common:actions.next")}
                    loadingNext={loadingMore}
                    canGoPrevious={currentPage > 1}
                    canGoNext={canAdvanceGitHubWorkItemsPage({
                      currentPage,
                      loadedPageCount: totalLoadedPages,
                      hasMoreRemoteItems: hasMoreFilteredIssues,
                    })}
                    onPrevious={handlePreviousPage}
                    onNext={() => void handleNextPage()}
                  />
                ) : null}
              </>
            )}
          </div>
        </section>
      </DetailPanelContainer>
    </div>
  );
}
