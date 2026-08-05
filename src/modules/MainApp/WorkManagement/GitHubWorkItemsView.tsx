import {
  CheckCircle2,
  CircleDot,
  CircleSlash,
  GitMerge,
  GitPullRequestDraft,
} from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { SelectOption } from "@src/components/Select";
import type { SettingsTableSelectFilter } from "@src/components/SettingsTable";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import type { WorkItemExternalAssigneeConfig } from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties/types";
import ProjectManagerBreadcrumb from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import {
  IssueDetailExternalLinkButton,
  IssueDetailHeaderContent,
  IssueDetailPanel,
  getIssueDetailTitle,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import { PrDetailHeaderContent } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailHeaderContent";
import {
  WorkManagementTable,
  type WorkManagementTableRow,
} from "@src/modules/shared/components/WorkManagementTable";
import {
  DetailPanelContainer,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";
import { normalizePrStatus } from "@src/shared/pr/prStatus";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { CreateIssueModal } from "./CreateIssueModal";
import {
  IssuePersonalFilterDropdown,
  ManagedIssueActionsCell,
  ManagedIssueAssigneeCell,
  ManagedIssueContextMeta,
  ManagedPrActionsCell,
} from "./GitHubWorkItemControls";
import {
  GitHubWorkItemStateTabs,
  GitHubWorkItemToolbarActions,
} from "./GitHubWorkItemList";
import {
  GITHUB_ITEM_KIND,
  type ManagedGitHubItem,
  type ManagedIssueItem,
  type ManagedPrItem,
} from "./githubManagedItemModel";
import {
  canManageIssueAssignees,
  canManageIssueStatus,
  canManagePrStatus,
  findGitHubRepoSource,
} from "./githubWorkItemPermissions";
import {
  GITHUB_WORK_ITEMS_PAGE_SIZE,
  canAdvanceGitHubWorkItemsPage,
} from "./githubWorkItemsPagination";
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
import type { IssueAssigneeControlState } from "./useGitHubIssueAssigneeMutations";
import type { IssueDetailState } from "./useGitHubIssueDetail";
import type {
  ManagedIssueStatusValue,
  ManagedPrStatusValue,
} from "./useGitHubWorkItemStatusMutations";

const PrDetailPanel = React.lazy(() =>
  import("@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel").then(
    (module) => ({ default: module.PrDetailPanel })
  )
);

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
  currentPage: number;
  totalLoadedPages: number;
  hasMoreFilteredIssues: boolean;
  createFormOpen: boolean;
  creatingIssue: boolean;
  issueDetail: IssueDetailState | null;
  prDetail: ManagedPrItem | null;
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
  onIssueStatusChange: (
    issue: ManagedIssueItem,
    status: ManagedIssueStatusValue
  ) => Promise<void>;
  getIssueAssigneeControlState: (
    issue: ManagedIssueItem
  ) => IssueAssigneeControlState;
  onLoadIssueAssignees: (issue: ManagedIssueItem) => void | Promise<void>;
  onIssueAssigneesChange: (
    issue: ManagedIssueItem,
    assignees: string[]
  ) => void | Promise<void>;
  onOpenPr: (pr: ManagedPrItem) => void;
  onAddPr: (pr: ManagedPrItem) => void;
  onPrStatusChange: (
    pr: ManagedPrItem,
    status: ManagedPrStatusValue
  ) => Promise<void>;
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

export function toGitHubPrDetailIdentity(pr: ManagedPrItem): PrIdentity {
  return {
    number: pr.id,
    title: pr.title,
    url: pr.rawPr.url,
    status: normalizePrStatus({
      state: pr.state,
      merged: pr.state === GITHUB_QUERY_STATE.MERGED,
      draft: pr.rawPr.draft,
    }),
    headBranch: pr.sourceBranch,
    baseBranch: pr.targetBranch,
  };
}

export function GitHubPrDetailBreadcrumb({
  identity,
  parentLabel,
  onBack,
}: {
  identity: PrIdentity;
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
          label: `#${identity.number} ${identity.title}`,
          content: (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <PrDetailHeaderContent identity={identity} />
            </span>
          ),
          fillAvailableWidth: true,
        },
      ]}
    />
  );
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
  currentPage,
  totalLoadedPages,
  hasMoreFilteredIssues,
  createFormOpen,
  creatingIssue,
  issueDetail,
  prDetail,
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
  onIssueStatusChange,
  getIssueAssigneeControlState,
  onLoadIssueAssignees,
  onIssueAssigneesChange,
  onOpenPr,
  onAddPr,
  onPrStatusChange,
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
  const readonlyReason = t("common:errors.messages.forbidden");
  const prDetailIdentity = useMemo(
    () => (prDetail ? toGitHubPrDetailIdentity(prDetail) : null),
    [prDetail]
  );
  const issueDetailAssigneeConfig = useMemo<
    WorkItemExternalAssigneeConfig | undefined
  >(() => {
    if (!issueDetail) return undefined;
    const source = findGitHubRepoSource(
      repoSources,
      issueDetail.source.repo,
      issueDetail.source.repoPath
    );
    const control = getIssueAssigneeControlState(issueDetail.source);
    const usersByLogin = new Map(
      [...issueDetail.issue.assignees, ...control.users].map((user) => [
        user.login.toLowerCase(),
        user,
      ])
    );
    const canManage = canManageIssueAssignees(source);
    return {
      currentAssigneeIds: issueDetail.issue.assignees.map(
        (assignee) => assignee.login
      ),
      options: Array.from(usersByLogin.values()).map((user) => ({
        id: user.login,
        label: user.login,
        avatar: user.avatar_url,
      })),
      loading: control.loading,
      error: control.error,
      disabled: !canManage || control.updating,
      readonlyReason: canManage ? t("common:status.loading") : readonlyReason,
      onOpen: () => onLoadIssueAssignees(issueDetail.source),
      onChangeAssigneeIds: (assigneeIds) =>
        onIssueAssigneesChange(issueDetail.source, assigneeIds),
    };
  }, [
    getIssueAssigneeControlState,
    issueDetail,
    onIssueAssigneesChange,
    onLoadIssueAssignees,
    readonlyReason,
    repoSources,
    t,
  ]);
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

  const headerContribution = useMemo(() => {
    if (issueDetail) {
      return {
        content: (
          <GitHubIssueDetailBreadcrumb
            issue={issueDetail.issue}
            parentLabel={datasetLabel}
            onBack={onBackFromDetail}
          />
        ),
        trailing: <IssueDetailExternalLinkButton issue={issueDetail.issue} />,
        joinWithFollowingRow: true,
      };
    }
    if (prDetailIdentity) {
      return {
        content: (
          <GitHubPrDetailBreadcrumb
            identity={prDetailIdentity}
            parentLabel={datasetLabel}
            onBack={onBackFromDetail}
          />
        ),
        joinWithFollowingRow: true,
      };
    }
    return null;
  }, [datasetLabel, issueDetail, onBackFromDetail, prDetailIdentity]);
  usePublishWorkstationTabHeader({
    host: "workManagement",
    content: headerContribution,
  });

  const tableSelectFilters = useMemo<SettingsTableSelectFilter[]>(
    () => [
      {
        key: "repository",
        value: effectiveSelectedRepo,
        defaultValue: repoOptions[0]?.key ?? effectiveSelectedRepo,
        options: repoOptions.map((option) => ({
          value: option.key,
          label: option.label,
        })),
        onChange: (value) => onRepoSelect(String(value)),
        minWidth: 190,
        variant: "default",
      },
    ],
    [effectiveSelectedRepo, onRepoSelect, repoOptions]
  );

  const tableRows = useMemo<ManagedGitHubItem[]>(() => {
    if (scope === GITHUB_QUERY_SCOPE.PR) {
      return pagedItems.filter(
        (item): item is ManagedPrItem => item.kind === GITHUB_ITEM_KIND.PR
      );
    }
    return pagedItems.filter(
      (item): item is ManagedIssueItem => item.kind === GITHUB_ITEM_KIND.ISSUE
    );
  }, [pagedItems, scope]);
  const settingsRows = useMemo<WorkManagementTableRow[]>(
    () =>
      tableRows.map((item) => {
        const source = findGitHubRepoSource(
          repoSources,
          item.repo,
          item.repoPath
        );
        const updated = (
          <span title={item.updatedAt}>{item.timeAgo || "—"}</span>
        );
        if (item.kind === GITHUB_ITEM_KIND.PR) {
          const prStatusValue: ManagedPrStatusValue =
            item.state === GITHUB_QUERY_STATE.OPEN ? "open" : "closed";
          const prStatusLabel =
            item.state === GITHUB_QUERY_STATE.MERGED
              ? t("common:pullRequests.status.merged", {
                  defaultValue: "Merged",
                })
              : item.rawPr.draft
                ? t("common:pullRequests.status.draft", {
                    defaultValue: "Draft",
                  })
                : prStatusValue === "open"
                  ? t("chat.panels.manageIssues.stateOpen")
                  : t("chat.panels.manageIssues.stateClosed");
          const prStatusIcon =
            item.state === GITHUB_QUERY_STATE.MERGED ? (
              <GitMerge size={14} strokeWidth={1.8} />
            ) : item.rawPr.draft ? (
              <GitPullRequestDraft size={14} strokeWidth={1.8} />
            ) : prStatusValue === "open" ? (
              <CircleDot size={14} strokeWidth={1.8} />
            ) : (
              <CheckCircle2 size={14} strokeWidth={1.8} />
            );
          return {
            key: `${item.kind}-${item.repo}-${item.id}`,
            id: `#${item.id}`,
            idSortValue: item.id,
            title: item.title,
            titleLinkOnRowHover: true,
            metadata: [
              item.repo,
              item.author,
              `${item.sourceBranch} → ${item.targetBranch}`,
            ],
            fillLastMetadata: true,
            statusSelect: {
              value: prStatusValue,
              label: prStatusLabel,
              icon: prStatusIcon,
              iconColor:
                item.state === GITHUB_QUERY_STATE.MERGED
                  ? "var(--color-purple-6)"
                  : prStatusValue === "open"
                    ? "var(--color-success-6)"
                    : "var(--color-text-3)",
              valueClassName:
                item.state === GITHUB_QUERY_STATE.MERGED
                  ? "text-purple-6"
                  : prStatusValue === "open"
                    ? "text-success-6"
                    : "text-text-2",
              options: [
                {
                  value: "open",
                  label: t("chat.panels.manageIssues.stateOpen"),
                  icon: <CircleDot size={14} strokeWidth={1.8} />,
                  iconColor: "var(--color-success-6)",
                },
                {
                  value: "closed",
                  label: t("chat.panels.manageIssues.stateClosed"),
                  icon: <CheckCircle2 size={14} strokeWidth={1.8} />,
                  iconColor: "var(--color-text-3)",
                },
              ],
              onChange: (value) =>
                onPrStatusChange(item, value as ManagedPrStatusValue),
              readonly:
                item.state === GITHUB_QUERY_STATE.MERGED ||
                !canManagePrStatus(item, source),
              readonlyReason,
              dataTestId: `github-pr-status-${item.id}`,
            },
            updated,
            actions: (
              <ManagedPrActionsCell
                pr={item}
                addLabel={t("chat.panels.manageIssues.addToChat")}
                onAddPr={onAddPr}
              />
            ),
            onClick: () => onOpenPr(item),
          };
        }
        const issueStatusValue: ManagedIssueStatusValue =
          item.state === "open"
            ? "open"
            : item.rawIssue.state_reason === "not_planned"
              ? "closed_not_planned"
              : "closed_completed";
        const issueStatusOptions = [
          {
            value: "open",
            label: t("chat.panels.manageIssues.stateOpen"),
            icon: <CircleDot size={14} strokeWidth={1.8} />,
            iconColor: "var(--color-success-6)",
          },
          {
            value: "closed_completed",
            label: t("chat.panels.manageIssues.closeAsCompleted", {
              defaultValue: "Close as completed",
            }),
            icon: <CheckCircle2 size={14} strokeWidth={1.8} />,
            iconColor: "var(--color-text-3)",
          },
          {
            value: "closed_not_planned",
            label: t("chat.panels.manageIssues.closeAsNotPlanned", {
              defaultValue: "Close as not planned",
            }),
            icon: <CircleSlash size={14} strokeWidth={1.8} />,
            iconColor: "var(--color-text-3)",
          },
        ];
        const selectedIssueStatus = issueStatusOptions.find(
          (option) => option.value === issueStatusValue
        )!;
        const assigneeControl = getIssueAssigneeControlState(item);
        return {
          key: `${item.kind}-${item.repo}-${item.id}`,
          id: `#${item.id}`,
          idSortValue: item.id,
          title: item.title,
          titleLinkOnRowHover: true,
          contextLeading: <ManagedIssueContextMeta issue={item} />,
          metadata: [item.repo, item.author],
          tags: item.labels.map((label) => label.name),
          assignee: (
            <ManagedIssueAssigneeCell
              issue={item}
              assignableUsers={assigneeControl.users}
              canManage={canManageIssueAssignees(source)}
              loading={assigneeControl.loading}
              loadError={assigneeControl.error}
              updating={assigneeControl.updating}
              noneLabel={t("common:common.none")}
              loadingLabel={t("common:status.loading")}
              searchPlaceholder={t("common:common.searchPlaceholder")}
              readonlyReason={readonlyReason}
              onOpen={onLoadIssueAssignees}
              onChange={onIssueAssigneesChange}
            />
          ),
          statusSelect: {
            value: issueStatusValue,
            label:
              item.state === "open"
                ? t("chat.panels.manageIssues.stateOpen")
                : t("chat.panels.manageIssues.stateClosed"),
            icon: selectedIssueStatus.icon,
            iconColor: selectedIssueStatus.iconColor,
            valueClassName:
              item.state === "open" ? "text-success-6" : "text-text-2",
            options: issueStatusOptions,
            onChange: (value) =>
              onIssueStatusChange(item, value as ManagedIssueStatusValue),
            readonly: !canManageIssueStatus(item, source),
            readonlyReason,
            dataTestId: `github-issue-status-${item.id}`,
          },
          updated,
          actions: (
            <ManagedIssueActionsCell
              issue={item}
              addLabel={t("chat.panels.manageIssues.addToChat")}
              openInBrowserLabel={t("common:previews.openInBrowser")}
              openInMyStationLabel={t("controlTower.sidebar.openInMyStation")}
              moreActionsLabel={t("common:actions.moreActions")}
              onOpenIssueInBrowser={onOpenIssueInBrowser}
              onOpenIssueInMyStation={onOpenIssueInMyStation}
              onAddIssue={onAddIssue}
            />
          ),
          onClick: () => onOpenIssue(item),
        };
      }),
    [
      getIssueAssigneeControlState,
      onAddIssue,
      onAddPr,
      onIssueAssigneesChange,
      onIssueStatusChange,
      onLoadIssueAssignees,
      onOpenIssue,
      onOpenIssueInBrowser,
      onOpenIssueInMyStation,
      onOpenPr,
      onPrStatusChange,
      readonlyReason,
      repoSources,
      t,
      tableRows,
    ]
  );

  const tableEmptyState = (() => {
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
          placement="detail-panel"
          subtitle={loadError}
          action={{ label: t("common:actions.retry"), onClick: onRefresh }}
          fillParentHeight
        />
      );
    }

    if (!loading && repoSources.length === 0) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          fillParentHeight
        />
      );
    }

    if (
      scope !== GITHUB_QUERY_SCOPE.PR &&
      !loading &&
      filteredItems.length === 0
    ) {
      return (
        <Placeholder
          variant="no-results"
          placement="detail-panel"
          fillParentHeight
        />
      );
    }

    return (
      <Placeholder
        variant={loading ? "loading" : loadError ? "error" : "no-results"}
        placement="detail-panel"
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
    );
  })();

  const issueDetailContent = issueDetail ? (
    <IssueDetailPanel
      issue={issueDetail.issue}
      timeline={issueDetail.timeline}
      timelineLoading={issueDetail.timelineLoading}
      submittingComment={issueDetail.submittingComment}
      showHeader={false}
      onCloseIssue={onCloseIssueDetail}
      onReopenIssue={onReopenIssueDetail}
      onAddComment={onAddIssueDetailComment}
      assigneeConfig={issueDetailAssigneeConfig}
    />
  ) : null;
  const prDetailContent =
    prDetail && prDetailIdentity ? (
      <React.Suspense
        fallback={
          <Placeholder
            variant="loading"
            placement="detail-panel"
            fillParentHeight
          />
        }
      >
        <PrDetailPanel
          identity={prDetailIdentity}
          repoPath={prDetail.repoPath}
          repoId={prDetail.repoId}
          showHeader={false}
        />
      </React.Suspense>
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
            {issueDetailContent ?? prDetailContent ?? (
              <WorkManagementTable
                rows={settingsRows}
                searchBar={{
                  searchValue: searchQuery,
                  searchPlaceholder: t(
                    "chat.panels.manageIssues.searchPlaceholder"
                  ),
                  onSearchChange: onSearchQueryChange,
                  onSearchClear: () => onSearchQueryChange(""),
                  tabPills:
                    scope === GITHUB_QUERY_SCOPE.ISSUE ? (
                      <GitHubWorkItemStateTabs
                        tabs={stateTabs}
                        activeTab={activeState}
                        onChange={handleStateChange}
                      />
                    ) : undefined,
                  rightContent: (
                    <GitHubWorkItemToolbarActions
                      refreshLabel={t("common:actions.refresh")}
                      refreshing={loading}
                      createAction={
                        scope === GITHUB_QUERY_SCOPE.ISSUE
                          ? {
                              label: t(
                                "chat.panels.manageIssues.createIssueTrigger"
                              ),
                              disabled: repoSources.length === 0,
                              onClick: () => onSetCreateFormOpen(true),
                            }
                          : undefined
                      }
                      onRefresh={onRefresh}
                    />
                  ),
                }}
                selectFilters={tableSelectFilters}
                selectFiltersExtra={
                  scope === GITHUB_QUERY_SCOPE.ISSUE ? (
                    <IssuePersonalFilterDropdown
                      options={issuePersonalFilterOptions}
                      selectedFilters={selectedIssuePersonalFilters}
                      filterLabel={t("common:actions.filter")}
                      onSelect={onIssuePersonalFiltersSelect}
                    />
                  ) : undefined
                }
                loading={loading}
                noDataElement={tableEmptyState}
                maxWidth="wide"
                testId={`github-${scope}-table`}
                pagination={
                  filteredItems.length > 0
                    ? {
                        pageIndex: currentPage - 1,
                        pageSize: GITHUB_WORK_ITEMS_PAGE_SIZE,
                        total: filteredItems.length,
                        pageCount: totalLoadedPages,
                        canPreviousPage: currentPage > 1,
                        canNextPage:
                          !loadingMore &&
                          canAdvanceGitHubWorkItemsPage({
                            currentPage,
                            loadedPageCount: totalLoadedPages,
                            hasMoreRemoteItems: hasMoreFilteredIssues,
                          }),
                        onPageChange: (pageIndex) => {
                          if (pageIndex < currentPage - 1) {
                            onPreviousPage();
                          } else if (pageIndex > currentPage - 1) {
                            void onNextPage();
                          }
                        },
                        pageLabel: t("common:pagination.pageOf", {
                          current: currentPage,
                          total: hasMoreFilteredIssues
                            ? `${totalLoadedPages}+`
                            : totalLoadedPages,
                        }),
                      }
                    : undefined
                }
              />
            )}
          </div>
        </section>
      </DetailPanelContainer>
    </div>
  );
}
