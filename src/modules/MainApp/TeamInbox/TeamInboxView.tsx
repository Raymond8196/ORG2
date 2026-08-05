import { Globe } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import InlineAlert from "@src/components/InlineAlert";
import {
  type ManagedPrItem,
  getManagedPullRequestKey,
} from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";
import SplitViewLayout from "@src/modules/shared/layouts/SplitViewLayout";
import { LoadingBar, Placeholder } from "@src/modules/shared/layouts/blocks";
import { normalizePrStatus } from "@src/shared/pr/prStatus";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import type { WorkItem } from "@src/types/core/workItem";
import { openExternalLink } from "@src/util/platform/ipcRenderer";

import {
  AssignedWorkItemDetail,
  CommentMentionDetail,
  TeamInboxList,
} from "./components";
import TeamInboxHeaderIconAction from "./components/TeamInboxHeaderIconAction";
import TeamInboxSessionDropSurface from "./components/TeamInboxSessionDropSurface";
import {
  type TeamInboxDataSource,
  type TeamInboxFilter,
  type TeamInboxIssue,
  type TeamInboxItem,
  type TeamInboxNavigationIntent,
  type TeamInboxUnreadCounts,
  countUnreadTeamInboxItemsByFilter,
  getTeamInboxItemKey,
  searchTeamInboxItems,
  selectTeamInboxItems,
  toTeamInboxNavigationIntent,
} from "./domain";
import type { TeamInboxItemFocusRequest } from "./store";
import { performTeamInboxReadTransition } from "./teamInboxReadTransitions";

export interface TeamInboxViewProps {
  dataSource?: TeamInboxDataSource;
  onNavigate?: (intent: TeamInboxNavigationIntent) => void;
  initialFilter?: TeamInboxFilter;
  focusRequest?: TeamInboxItemFocusRequest | null;
  pageSize?: number;
  viewerMemberIds?: readonly string[];
  pullRequests?: readonly ManagedPrItem[];
  pullRequestsLoading?: boolean;
  pullRequestsError?: string | null;
  onRefreshPullRequests?: () => void;
}

const PullRequestDetailPanel = React.lazy(() =>
  import("@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel").then(
    (module) => ({ default: module.PrDetailPanel })
  )
);

const EMPTY_TEAM_INBOX_DATA_SOURCE: TeamInboxDataSource = {
  async listPage() {
    return { items: [], nextCursor: null };
  },
};

interface LoadState {
  status: "loading" | "ready" | "warning" | "error";
  message: string | null;
}

interface TeamInboxSelectionState {
  itemId: string | null;
  supersededFocusRequestId: number | null;
}

const TeamInboxView: React.FC<TeamInboxViewProps> = ({
  dataSource = EMPTY_TEAM_INBOX_DATA_SOURCE,
  onNavigate,
  initialFilter = "all",
  focusRequest = null,
  pageSize = 50,
  viewerMemberIds = [],
  pullRequests = [],
  pullRequestsLoading = false,
  pullRequestsError = null,
  onRefreshPullRequests,
}) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TeamInboxFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<TeamInboxItem[]>([]);
  const [authoritativeUnreadCounts, setAuthoritativeUnreadCounts] =
    useState<TeamInboxUnreadCounts | null>(null);
  const [selectedPullRequestKey, setSelectedPullRequestKey] = useState<
    string | null
  >(null);
  const [selection, setSelection] = useState<TeamInboxSelectionState>({
    itemId: null,
    supersededFocusRequestId: null,
  });
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: null,
  });
  const [reloadRevision, setReloadRevision] = useState(0);
  const [dismissedLoadNoticeKey, setDismissedLoadNoticeKey] = useState<
    string | null
  >(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const issueMessage = useCallback(
    (issue: TeamInboxIssue): string => {
      if (issue.code === "identity_unresolved") {
        return t("teamInbox.errors.identity");
      }
      if (issue.code === "partial_load") {
        return t("teamInbox.errors.partialLoad");
      }
      return t("teamInbox.errors.load");
    },
    [t]
  );

  useEffect(() => {
    const abortController = new AbortController();

    void dataSource
      .listPage({ limit: pageSize, signal: abortController.signal })
      .then((page) => {
        if (abortController.signal.aborted) return;
        setItems(page.items);
        setAuthoritativeUnreadCounts(page.unreadCounts ?? null);
        setHasMore(page.nextCursor != null);
        setLoadState(
          page.loading
            ? { status: "loading", message: null }
            : page.issue
              ? {
                  status:
                    page.issue.code === "partial_load" ? "warning" : "error",
                  message: issueMessage(page.issue),
                }
              : { status: "ready", message: null }
        );
      })
      .catch((reason: unknown) => {
        if (abortController.signal.aborted) return;
        setLoadState({
          status: "error",
          message:
            reason instanceof Error
              ? "issue" in reason &&
                reason.issue &&
                typeof reason.issue === "object" &&
                "code" in reason.issue
                ? issueMessage(reason.issue as TeamInboxIssue)
                : reason.message
              : t("teamInbox.errors.load"),
        });
      });

    return () => abortController.abort();
  }, [dataSource, issueMessage, pageSize, reloadRevision, t]);

  const loadNoticeKey =
    (loadState.status === "error" || loadState.status === "warning") &&
    loadState.message
      ? `${reloadRevision}:${loadState.status}:${loadState.message}`
      : null;

  const dismissLoadNotice = useCallback(() => {
    setDismissedLoadNoticeKey(loadNoticeKey);
  }, [loadNoticeKey]);

  useEffect(() => {
    if (!dataSource.subscribe) return;
    return dataSource.subscribe(() => {
      setReloadRevision((value) => value + 1);
    });
  }, [dataSource]);

  const focusRequestActive =
    focusRequest !== null &&
    focusRequest.requestId !== selection.supersededFocusRequestId;
  const visibleFilter = focusRequestActive ? "all" : filter;
  const visibleQuery = focusRequestActive ? "" : query;
  const requestedItemId = focusRequestActive
    ? focusRequest.itemKey
    : selection.itemId;
  const visibleItems = useMemo(
    () =>
      searchTeamInboxItems(
        selectTeamInboxItems(items, visibleFilter),
        visibleQuery
      ),
    [items, visibleFilter, visibleQuery]
  );
  const loadedUnreadCounts = useMemo(
    () => countUnreadTeamInboxItemsByFilter(items),
    [items]
  );
  const unreadCounts = authoritativeUnreadCounts ?? loadedUnreadCounts;
  const totalUnread = unreadCounts.all;
  const selectedPullRequest = useMemo(
    () =>
      pullRequests.find(
        (pullRequest) =>
          getManagedPullRequestKey(pullRequest) === selectedPullRequestKey
      ) ?? null,
    [pullRequests, selectedPullRequestKey]
  );
  const selectedPullRequestIdentity = useMemo<PrIdentity | null>(
    () =>
      selectedPullRequest
        ? {
            number: selectedPullRequest.id,
            title: selectedPullRequest.title,
            url: selectedPullRequest.rawPr.url,
            status: normalizePrStatus({
              state: selectedPullRequest.state,
              merged: selectedPullRequest.state === "merged",
              draft: selectedPullRequest.rawPr.draft,
            }),
            headBranch: selectedPullRequest.sourceBranch,
            baseBranch: selectedPullRequest.targetBranch,
          }
        : null,
    [selectedPullRequest]
  );
  const selectedItem = useMemo(() => {
    if (!requestedItemId) return null;
    return (
      visibleItems.find(
        (item) => getTeamInboxItemKey(item) === requestedItemId
      ) ?? null
    );
  }, [requestedItemId, visibleItems]);
  const selectedItemId =
    !selectedPullRequest && selectedItem
      ? getTeamInboxItemKey(selectedItem)
      : null;

  const markItemRead = useCallback(
    (item: TeamInboxItem) => {
      if (item.readAt !== null) return;
      void performTeamInboxReadTransition("read", item, dataSource).then(
        (result) => {
          if (!result.ok) {
            setLoadState({
              status: "error",
              message: t("teamInbox.errors.markRead"),
            });
          }
        }
      );
    },
    [dataSource, t]
  );

  useEffect(() => {
    if (!selectedPullRequest && selectedItem) markItemRead(selectedItem);
  }, [markItemRead, selectedItem, selectedPullRequest]);

  const handleLoadMore = () => {
    if (!dataSource.loadMore || loadingMore) return;
    setLoadingMore(true);
    void dataSource
      .loadMore()
      .then(() => {
        if (mountedRef.current) {
          setReloadRevision((value) => value + 1);
        }
      })
      .catch(() => {
        setLoadState({
          status: "error",
          message: t("teamInbox.errors.loadMore"),
        });
      })
      .finally(() => {
        if (mountedRef.current) setLoadingMore(false);
      });
  };

  const handleRefresh = () => {
    onRefreshPullRequests?.();
    setLoadState({ status: "loading", message: null });
    if (!dataSource.refresh) {
      setReloadRevision((value) => value + 1);
      return;
    }
    void dataSource
      .refresh()
      .then(() => {
        if (mountedRef.current) {
          setReloadRevision((value) => value + 1);
        }
      })
      .catch(() => {
        setLoadState({
          status: "error",
          message: t("teamInbox.errors.refresh"),
        });
      });
  };

  const handleSelect = (item: TeamInboxItem) => {
    setSelectedPullRequestKey(null);
    if (focusRequestActive) {
      setFilter("all");
      setQuery("");
    }
    setSelection({
      itemId: getTeamInboxItemKey(item),
      supersededFocusRequestId: focusRequest?.requestId ?? null,
    });
  };

  const handleFilterChange = (nextFilter: TeamInboxFilter) => {
    if (focusRequestActive) setQuery("");
    setFilter(nextFilter);
    setSelection((current) => ({
      ...current,
      supersededFocusRequestId: focusRequest?.requestId ?? null,
    }));
  };

  const handleQueryChange = (nextQuery: string) => {
    if (focusRequestActive) setFilter("all");
    setQuery(nextQuery);
    setSelection((current) => ({
      ...current,
      supersededFocusRequestId: focusRequest?.requestId ?? null,
    }));
  };

  const handleSelectPullRequest = (pullRequest: ManagedPrItem) => {
    setSelectedPullRequestKey(getManagedPullRequestKey(pullRequest));
    setSelection((current) => ({
      ...current,
      supersededFocusRequestId: focusRequest?.requestId ?? null,
    }));
  };

  const handleMarkRead = (item: TeamInboxItem) => {
    markItemRead(item);
  };

  const handleMarkUnread = (item: TeamInboxItem) => {
    if (item.readAt === null) return;
    void performTeamInboxReadTransition("unread", item, dataSource).then(
      (result) => {
        if (!result.ok) {
          setLoadState({
            status: "error",
            message: t("teamInbox.errors.markUnread"),
          });
        }
      }
    );
  };

  const handleMarkAllRead = () => {
    const filterUnreadCount =
      visibleFilter === "all"
        ? unreadCounts.all
        : visibleFilter === "mentions"
          ? unreadCounts.mentions
          : unreadCounts.assigned;
    if (filterUnreadCount === 0) return;
    void dataSource.markAllRead?.([], visibleFilter).catch(() => {
      setLoadState({
        status: "error",
        message: t("teamInbox.errors.markAllRead"),
      });
    });
  };

  const handleWorkItemUpdated = useCallback(
    (sourceItem: TeamInboxItem, workItem: WorkItem) => {
      if (sourceItem.kind !== "assigned_work_item") return;
      const sourceKey = getTeamInboxItemKey(sourceItem);
      const assignee = workItem.assignee;
      const belongsToViewer = assignee
        ? viewerMemberIds.length > 0
          ? viewerMemberIds.includes(assignee.id)
          : assignee.id === sourceItem.payload.assigneeMemberId
        : false;
      const status =
        workItem.workItemStatus ?? workItem.status ?? sourceItem.payload.status;
      const updatedAt = workItem.updated_time || sourceItem.payload.updatedAt;
      const nextItem: TeamInboxItem | null =
        assignee && belongsToViewer
          ? {
              ...sourceItem,
              occurredAt: updatedAt,
              payload: {
                ...sourceItem.payload,
                title: workItem.name || sourceItem.payload.title,
                status,
                priority: workItem.priority ?? sourceItem.payload.priority,
                assigneeMemberId: assignee.id,
                assigneeName: assignee.name,
                summary: workItem.spec?.trim() || undefined,
                handoff: workItem.handoff,
                updatedAt,
              },
            }
          : null;
      if (dataSource.reconcileItem) {
        dataSource.reconcileItem(sourceKey, nextItem);
        return;
      }
      setItems((current) =>
        current.flatMap((candidate) =>
          getTeamInboxItemKey(candidate) === sourceKey
            ? nextItem
              ? [nextItem]
              : []
            : [candidate]
        )
      );
    },
    [dataSource, viewerMemberIds]
  );

  const detail = (() => {
    if (selectedPullRequest && selectedPullRequestIdentity) {
      return (
        <React.Suspense fallback={<LoadingBar />}>
          <PullRequestDetailPanel
            identity={selectedPullRequestIdentity}
            repoPath={selectedPullRequest.repoPath}
            repoId={selectedPullRequest.repoId}
            headerActions={
              <TeamInboxHeaderIconAction
                label={t("previews.openInBrowser")}
                icon={<Globe size={14} strokeWidth={1.75} aria-hidden />}
                onClick={() =>
                  void openExternalLink(selectedPullRequestIdentity.url)
                }
                testId="team-inbox-open-github-pr"
              />
            }
          />
        </React.Suspense>
      );
    }
    if (loadState.status === "loading") {
      return <LoadingBar />;
    }
    if (loadState.status === "error" && items.length === 0) {
      return (
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={t("teamInbox.errors.loadTitle")}
          subtitle={loadState.message ?? undefined}
          action={{ label: t("common:actions.retry"), onClick: handleRefresh }}
          fillParentHeight
        />
      );
    }
    if (!selectedItem) {
      return (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("teamInbox.empty.selectTitle")}
          subtitle={t("teamInbox.empty.selectSubtitle")}
          fillParentHeight
        />
      );
    }
    if (selectedItem.kind === "comment_mention") {
      return (
        <CommentMentionDetail
          item={selectedItem}
          onMarkRead={dataSource.markRead ? handleMarkRead : undefined}
          onMarkUnread={dataSource.markUnread ? handleMarkUnread : undefined}
          onNavigate={
            onNavigate
              ? () => onNavigate(toTeamInboxNavigationIntent(selectedItem))
              : undefined
          }
        />
      );
    }
    return (
      <AssignedWorkItemDetail
        item={selectedItem}
        onMarkRead={dataSource.markRead ? handleMarkRead : undefined}
        onMarkUnread={dataSource.markUnread ? handleMarkUnread : undefined}
        onNavigate={onNavigate}
        onWorkItemUpdated={(workItem) =>
          handleWorkItemUpdated(selectedItem, workItem)
        }
      />
    );
  })();

  const loadNotice =
    loadNoticeKey &&
    dismissedLoadNoticeKey !== loadNoticeKey &&
    (items.length > 0 || pullRequests.length > 0) ? (
      <InlineAlert
        type={loadState.status === "warning" ? "warning" : "danger"}
        hideIcon
        onClose={dismissLoadNotice}
        autoCloseMs={3000}
        role="status"
        dataTestId="team-inbox-load-notice"
        closeAriaLabel={t("common:actions.close")}
        className={`shrink-0 !rounded-none !border-x-0 !border-b-0 !px-3 !py-2 ${
          loadState.status === "warning" ? "bg-warning-6/10" : "bg-danger-1"
        }`}
      >
        {loadState.message}
      </InlineAlert>
    ) : null;

  return (
    <TeamInboxSessionDropSurface
      dataSource={dataSource}
      onNavigate={onNavigate}
    >
      <div className="flex h-full min-h-0 flex-col">
        <SplitViewLayout
          className="min-h-0 flex-1 rounded-page"
          listWidth={360}
          minListWidth={280}
          maxListWidth={480}
          resizable
          collapsible
          hideBreadcrumbWhenSidebarCollapsed
          listPanelBackgroundClassName="bg-chat-pane"
          mainContentClassName="bg-chat-pane"
          listContent={
            loadState.status === "error" &&
            items.length === 0 &&
            pullRequests.length === 0 ? (
              <Placeholder
                variant="error"
                placement="sidebar"
                title={t("teamInbox.errors.loadTitle")}
                subtitle={loadState.message ?? undefined}
                action={{
                  label: t("common:actions.retry"),
                  onClick: handleRefresh,
                }}
                fillParentHeight
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1">
                  <TeamInboxList
                    filter={visibleFilter}
                    items={visibleItems}
                    selectedItemId={selectedItemId}
                    totalUnread={totalUnread}
                    unreadCounts={unreadCounts}
                    query={visibleQuery}
                    loading={
                      loadState.status === "loading" || pullRequestsLoading
                    }
                    pullRequests={pullRequests}
                    pullRequestsLoading={pullRequestsLoading}
                    pullRequestsError={pullRequestsError}
                    selectedPullRequestKey={selectedPullRequestKey}
                    onQueryChange={handleQueryChange}
                    onFilterChange={handleFilterChange}
                    onSelectItem={handleSelect}
                    onSelectPullRequest={handleSelectPullRequest}
                    onRefresh={handleRefresh}
                    onMarkAllRead={
                      dataSource.markAllRead ? handleMarkAllRead : undefined
                    }
                    hasMore={hasMore}
                    loadingMore={loadingMore}
                    onLoadMore={
                      dataSource.loadMore ? handleLoadMore : undefined
                    }
                  />
                </div>
                {loadNotice}
              </div>
            )
          }
          mainContent={detail}
        />
      </div>
    </TeamInboxSessionDropSurface>
  );
};

export default TeamInboxView;
