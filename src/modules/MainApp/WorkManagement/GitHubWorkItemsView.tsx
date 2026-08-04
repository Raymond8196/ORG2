import React, { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { SelectOption } from "@src/components/Select";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import ProjectManagerBreadcrumb from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import {
  IssueDetailExternalLinkButton,
  IssueDetailHeaderContent,
  IssueDetailPanel,
  getIssueDetailTitle,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import {
  DetailPanelContainer,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import { CreateIssueModal } from "./CreateIssueModal";
import {
  IssuePersonalFilterDropdown,
  ManagedIssueRow,
  ManagedPrRow,
  RepoFilterPill,
} from "./GitHubWorkItemControls";
import {
  GitHubWorkItemListFrame,
  GitHubWorkItemPagination,
  GitHubWorkItemSearch,
  GitHubWorkItemSection,
  GitHubWorkItemStateTabs,
  GitHubWorkItemTableSurface,
  GitHubWorkItemToolbarActions,
} from "./GitHubWorkItemList";
import {
  GITHUB_ITEM_KIND,
  type ManagedGitHubItem,
  type ManagedIssueItem,
  type ManagedPrItem,
  groupPullRequestsIntoTodoSections,
} from "./githubManagedItemModel";
import { canAdvanceGitHubWorkItemsPage } from "./githubWorkItemsPagination";
import {
  GITHUB_QUERY_SCOPE,
  GITHUB_QUERY_STATE,
  type GitHubQueryScope,
  type ParsedGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";
import type {
  GitHubRepoSource,
  IssueRepoFilter,
  RepoFilterOption,
} from "./githubWorkItemsTypes";
import type { IssueDetailState } from "./useGitHubIssueDetail";

interface GitHubWorkItemsViewProps {
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  singleRowHeader: boolean;
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

export function GitHubIssueDetailBreadcrumb({
  issue,
  parentLabel,
  onBack,
}: {
  issue: IssueDetailState["issue"];
  parentLabel: string;
  onBack: () => void;
}): React.ReactNode {
  return (
    <ProjectManagerBreadcrumb
      segments={[
        {
          label: parentLabel,
          onClick: onBack,
          title: parentLabel,
        },
        {
          label: getIssueDetailTitle(issue),
          content: <IssueDetailHeaderContent issue={issue} />,
          fillAvailableWidth: true,
        },
      ]}
    />
  );
}

export function shouldJoinGitHubWorkItemsHeader({
  detailOpen,
  singleRowHeader,
}: {
  detailOpen: boolean;
  singleRowHeader: boolean;
}): boolean {
  return detailOpen || !singleRowHeader;
}

export function GitHubWorkItemsView({
  scope,
  singleRowHeader,
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
  const datasetLabel =
    scope === GITHUB_QUERY_SCOPE.ISSUE
      ? t("kanban.sidebar.githubIssues")
      : t("kanban.sidebar.githubPrs");
  const listScrollRef = useRef<HTMLDivElement>(null);
  const activeState =
    scope === GITHUB_QUERY_SCOPE.PR &&
    parsedSearchQuery.state === GITHUB_QUERY_STATE.MERGED
      ? GITHUB_QUERY_STATE.CLOSED
      : (parsedSearchQuery.state ?? GITHUB_QUERY_STATE.OPEN);
  const stateTabs = useMemo(
    () => [
      {
        key: GITHUB_QUERY_STATE.OPEN,
        label: t("chat.panels.manageIssues.stateOpen"),
      },
      {
        key: GITHUB_QUERY_STATE.CLOSED,
        label: t("chat.panels.manageIssues.stateClosed"),
      },
    ],
    [t]
  );
  const handleStateChange = useCallback(
    (state: string) => {
      if (
        state !== GITHUB_QUERY_STATE.OPEN &&
        state !== GITHUB_QUERY_STATE.CLOSED
      ) {
        return;
      }
      updateSearchQuery((query) => {
        query.state = state;
      });
    },
    [updateSearchQuery]
  );

  const headerContent = useMemo(
    () =>
      issueDetail ? (
        <GitHubIssueDetailBreadcrumb
          issue={issueDetail.issue}
          parentLabel={datasetLabel}
          onBack={onBackFromDetail}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <RepoFilterPill
            options={repoOptions}
            selectedRepo={effectiveSelectedRepo}
            allReposLabel={t("chat.manageIssues.allRepositories")}
            onSelectRepo={onRepoSelect}
          />
          {scope === GITHUB_QUERY_SCOPE.ISSUE ? (
            <GitHubWorkItemStateTabs
              tabs={stateTabs}
              activeTab={activeState}
              onChange={handleStateChange}
            />
          ) : null}
          {scope === GITHUB_QUERY_SCOPE.ISSUE ? (
            <IssuePersonalFilterDropdown
              options={issuePersonalFilterOptions}
              selectedFilters={selectedIssuePersonalFilters}
              filterLabel={t("common:actions.filter")}
              onSelect={onIssuePersonalFiltersSelect}
            />
          ) : null}
          {singleRowHeader ? (
            <GitHubWorkItemSearch
              value={searchQuery}
              onChange={onSearchQueryChange}
              placeholder={t("chat.panels.manageIssues.searchPlaceholder")}
            />
          ) : null}
        </div>
      ),
    [
      effectiveSelectedRepo,
      activeState,
      datasetLabel,
      handleStateChange,
      issuePersonalFilterOptions,
      issueDetail,
      singleRowHeader,
      onSearchQueryChange,
      onIssuePersonalFiltersSelect,
      onBackFromDetail,
      stateTabs,
      onRepoSelect,
      repoOptions,
      searchQuery,
      scope,
      selectedIssuePersonalFilters,
      t,
    ]
  );
  const headerTrailing = useMemo(
    () =>
      issueDetail ? (
        <IssueDetailExternalLinkButton issue={issueDetail.issue} />
      ) : (
        <div className="flex shrink-0 items-center gap-px">
          <GitHubWorkItemToolbarActions
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
        </div>
      ),
    [
      issueDetail,
      loading,
      onRefresh,
      onSetCreateFormOpen,
      repoSources.length,
      scope,
      t,
    ]
  );
  const headerContribution = useMemo(
    () => ({
      content: headerContent,
      trailing: headerTrailing,
      joinWithFollowingRow: shouldJoinGitHubWorkItemsHeader({
        detailOpen: Boolean(issueDetail),
        singleRowHeader,
      }),
    }),
    [headerContent, headerTrailing, issueDetail, singleRowHeader]
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
  const pullRequestTodoSections = groupPullRequestsIntoTodoSections(pagedItems);
  const pagedIssues = pagedItems.filter(
    (item): item is ManagedIssueItem => item.kind === GITHUB_ITEM_KIND.ISSUE
  );
  const renderPrRows = (items: ManagedPrItem[]) =>
    items.map((item) => (
      <div key={`pr-${item.repo}-${item.id}`} className="w-full">
        <ManagedPrRow
          pr={item}
          addLabel={t("chat.panels.manageIssues.addToChat")}
          onOpenPr={onOpenPr}
          onAddPr={onAddPr}
        />
      </div>
    ));
  const visibleRows =
    scope === GITHUB_QUERY_SCOPE.PR ? (
      <>
        {pullRequestTodoSections.reviewRequested.length > 0 ? (
          <GitHubWorkItemSection
            label={t("chat.panels.manageIssues.pullRequests.reviewRequested")}
            testId="github-pr-review-requested"
          >
            {renderPrRows(pullRequestTodoSections.reviewRequested)}
          </GitHubWorkItemSection>
        ) : null}
        {pullRequestTodoSections.authoredByViewer.length > 0 ? (
          <GitHubWorkItemSection
            label={t("chat.panels.manageIssues.pullRequests.authoredByMe")}
            testId="github-pr-authored"
          >
            {renderPrRows(pullRequestTodoSections.authoredByViewer)}
          </GitHubWorkItemSection>
        ) : null}
        {pullRequestTodoSections.otherTodos.length > 0 ? (
          <GitHubWorkItemSection
            label={t("chat.panels.manageIssues.pullRequests.otherTodos")}
            testId="github-pr-other-todos"
          >
            {renderPrRows(pullRequestTodoSections.otherTodos)}
          </GitHubWorkItemSection>
        ) : null}
      </>
    ) : (
      <div className="divide-y divide-border-2">
        {pagedIssues.map((item) => (
          <div key={`issue-${item.repo}-${item.id}`} className="w-full">
            <ManagedIssueRow
              issue={item}
              addLabel={t("chat.panels.manageIssues.addToChat")}
              openInBrowserLabel={t("common:previews.openInBrowser")}
              openInMyStationLabel={t("controlTower.sidebar.openInMyStation")}
              moreActionsLabel={t("common:actions.moreActions")}
              onOpenIssue={onOpenIssue}
              onOpenIssueInBrowser={onOpenIssueInBrowser}
              onOpenIssueInMyStation={onOpenIssueInMyStation}
              onAddIssue={onAddIssue}
            />
          </div>
        ))}
      </div>
    );

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

    return (
      <GitHubWorkItemListFrame
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
          visibleRows
        )}
      </GitHubWorkItemListFrame>
    );
  })();

  const issueDetailContent = issueDetail ? (
    <IssueDetailPanel
      issue={issueDetail.issue}
      timeline={issueDetail.timeline}
      timelineLoading={issueDetail.timelineLoading}
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
                {!singleRowHeader ? (
                  <div className="flex h-10 shrink-0 items-center border-b border-border-2 px-3">
                    <GitHubWorkItemSearch
                      value={searchQuery}
                      onChange={onSearchQueryChange}
                      placeholder={t(
                        "chat.panels.manageIssues.searchPlaceholder"
                      )}
                    />
                  </div>
                ) : null}
                <GitHubWorkItemTableSurface>
                  <div
                    ref={listScrollRef}
                    className="min-h-0 flex-1 overflow-y-auto scrollbar-hide"
                  >
                    {listContent}
                  </div>
                </GitHubWorkItemTableSurface>
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
