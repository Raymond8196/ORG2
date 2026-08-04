import { useAtomValue, useSetAtom } from "jotai";
import { Search } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { teamInboxUnreadCountAtom } from "@src/modules/MainApp/TeamInbox/store";
import { useTeamInboxDataSource } from "@src/modules/MainApp/TeamInbox/useTeamInboxDataSource";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { TUTORIALS_OPEN_EVENT } from "@src/scaffold/Tutorials/tutorialRegistry";
import { hasProjectsAtom } from "@src/store/project";
import {
  activeSessionCreatorDraftIdAtom,
  deleteSessionCreatorDraftAtom,
  loadSessionRoster,
  promoteActiveSessionCreatorDraftAtom,
  sessionCreatorDraftListAtom,
  sessionLoadingAtom,
  sessionPaginationAtom,
  sessionsAtom,
  visitedSessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { CHAT_PANEL_CREATE_TARGET } from "@src/store/ui/chatPanelAtom";
import {
  clearSessionSidebarRevealAtom,
  sessionSidebarRevealRequestAtom,
  sidebarCollapsedAtom,
} from "@src/store/ui/sidebarAtom";
import { WORK_MANAGEMENT_SECTION } from "@src/store/workstation";

import { SidebarBottomBar, SidebarMenuSearchInput } from "../../blocks";
import SidebarSettingsMenuButton from "../../blocks/SidebarSettingsMenuButton";
import NavigationSidebar from "../../variants/NavigationSidebar";
import SidebarGuideButton from "../SidebarGuideButton";
import {
  SIDEBAR_GUIDE_MILESTONE,
  type SidebarGuideCompletion,
} from "../sidebarGuideProgress";
import { DEFAULT_COLLAPSED_SECTION_IDS } from "../workstationSidebarData";
import { SidebarDialogs } from "./SidebarDialogs";
import {
  type WorkstationSidebarViewKey,
  WorkstationSidebarViewSwitcher,
} from "./WorkstationSidebarViewSwitcher";
import { useLocalChannelsSection } from "./localChannelsSection";
import { useWorkstationSidebarBottomActions } from "./sidebarConnector.bottomActions";
import { useWorkstationSidebarChatPanelAtoms } from "./sidebarConnector.chatPanelAtoms";
import { useWorkstationSidebarChrome } from "./sidebarConnector.chrome";
import { useWorkstationSidebarCloudMenuData } from "./sidebarConnector.cloudMenuData";
import { buildWorkstationSidebarLabels } from "./sidebarConnector.labels";
import { useWorkstationSidebarMenuDecoration } from "./sidebarConnector.menuDecoration";
import { useWorkstationSidebarPinnedAndRevealData } from "./sidebarConnector.pinnedAndRevealData";
import { useWorkstationSidebarRevealNavigationEffects } from "./sidebarConnector.revealNavigationEffects";
import { useWorkstationSidebarRevealRequestState } from "./sidebarConnector.revealRequestState";
import { useWorkstationSidebarScopeAndPagination } from "./sidebarConnector.scopeAndPagination";
import { useWorkstationSidebarSelectionAndNavigation } from "./sidebarConnector.selectionAndNavigation";
import { useWorkstationSidebarSessionAndProjectMenuItems } from "./sidebarConnector.sessionAndProjectMenuItems";
import { useWorkstationSidebarSessionInteractionHandlers } from "./sidebarConnector.sessionInteractionHandlers";
import { SidebarSearchShortcutTooltip } from "./sidebarTabs";
import type {
  WorkstationSidebarKey,
  WorkstationSidebarSearchKey,
} from "./types";

/**
 * Workstation sidebar coordinator. The bulk of this connector's state,
 * effects, and derived data live in sibling `sidebarConnector.*` modules
 * (see each file's own header comment) — this component wires them
 * together in the same order they used to run inline and renders the
 * result. `cloudSessionsSection.tsx` supplies the cloud "Team sessions"
 * data consumed here via `sidebarConnector.cloudMenuData`.
 */
export const WorkstationSidebarConnector: React.FC = () => {
  const { t } = useTranslation("navigation");
  const { t: tProjects } = useTranslation("projects");
  const { t: tSessions } = useTranslation("sessions");
  const { t: tCommonRaw } = useTranslation();
  const tCommon = useCallback(
    (key: string, defaultValue?: string) => tCommonRaw(key, { defaultValue }),
    [tCommonRaw]
  );
  const location = useLocation();
  const navigate = useNavigate();
  const sessions = useAtomValue(sessionsAtom);
  const hasProjects = useAtomValue(hasProjectsAtom);
  useTeamInboxDataSource();
  const teamInboxUnreadCount = useAtomValue(teamInboxUnreadCountAtom);
  const sessionsLoading = useAtomValue(sessionLoadingAtom);
  const sessionPagination = useAtomValue(sessionPaginationAtom);
  const sessionSidebarRevealRequest = useAtomValue(
    sessionSidebarRevealRequestAtom
  );
  const clearSessionSidebarReveal = useSetAtom(clearSessionSidebarRevealAtom);
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const visitedSessions = useAtomValue(visitedSessionsAtom);
  const sessionCreatorDrafts = useAtomValue(sessionCreatorDraftListAtom);
  const activeSessionCreatorDraftId = useAtomValue(
    activeSessionCreatorDraftIdAtom
  );
  const promoteActiveSessionCreatorDraft = useSetAtom(
    promoteActiveSessionCreatorDraftAtom
  );
  const deleteSessionCreatorDraft = useSetAtom(deleteSessionCreatorDraftAtom);

  const {
    chatPanelContentMode,
    chatPanelCreateTarget,
    chatPanelSelectedWorkItem,
    chatPanelSelectedProject,
    setChatPanelCreateTarget,
    navigateChatPanel,
    setStationChatVisible,
    setStationMode,
    activeWorkManagementSection,
    workManagementProjectsView,
    setWorkManagementProjectsView,
    openWorkManagementTab,
    openOrganizationTab,
    openSessionInNewChatTab,
    openSessionInWorkstation,
    openOrReplaceSessionInChatPanelTab,
    activateChatPanelTab,
    openStartPageTab,
    openCreateTargetInStartPage,
    openRuntimeTab,
    openTeamInboxTab,
    closeAndDestroyChatPanelTab,
  } = useWorkstationSidebarChatPanelAtoms();

  const { openSession } = useSessionView();
  const activeSessionId = useAtomValue(workstationActiveSessionIdAtom) ?? "";
  const { goToNewSession, navigateTo } = useAppNavigation();
  const [activeSidebarKey, setActiveSidebarKey] =
    useState<WorkstationSidebarKey>("workstation");
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [activeSessionMoreMenuId, setActiveSessionMoreMenuId] = useState("");
  const [projectsSelectedMenuItemId, setProjectsSelectedMenuItemId] =
    useState("");
  const [workItemsOpen, setWorkItemsOpen] = useState(false);
  const workItemsContentVisible =
    activeSidebarKey === "workstation" && workItemsOpen;
  const channelSidebarVisible =
    activeSidebarKey === "workstation" && channelsOpen;
  const projectsSidebarVisible =
    activeSidebarKey === "projects" || workItemsContentVisible;
  const activeSidebarSearchKey: WorkstationSidebarSearchKey =
    workItemsContentVisible
      ? "projects"
      : channelSidebarVisible
        ? "channels"
        : activeSidebarKey;
  const [sidebarSearchQueries, setSidebarSearchQueries] = useState<
    Record<WorkstationSidebarSearchKey, string>
  >({ workstation: "", projects: "", channels: "" });
  const handleViewChange = useCallback((key: WorkstationSidebarViewKey) => {
    setActiveSidebarKey("workstation");
    setChannelsOpen(key === "channels");
    setWorkItemsOpen(key === "work-items");
  }, []);
  const activeViewKey: WorkstationSidebarViewKey =
    activeSidebarKey === "projects" || workItemsContentVisible
      ? "work-items"
      : channelSidebarVisible
        ? "channels"
        : "sessions";

  const handleSidebarSearchChange = useCallback(
    (value: string) => {
      setSidebarSearchQueries((currentQueries) => ({
        ...currentQueries,
        [activeSidebarSearchKey]: value,
      }));
      if (activeSidebarSearchKey === "workstation") {
        void loadSessionRoster();
      }
    },
    [activeSidebarSearchKey]
  );

  const {
    sortedSessions,
    activeCloudOrgId,
    activeOrgId,
    activeProjectOrgId,
    cloudSessionFilter,
    cloudTaggedSessionIds,
    handleCloudSessionFilterChange,
    manageableCloudOrg,
    manageableLocalOrg,
    orgSelectorOptions,
    personalHiddenCloudTaggedIds,
    sessionFilterOrgIds,
    setSelectedOrgId,
    repoPathToName,
    groupByMode,
    setGroupByMode,
    includeExternal,
    setIncludeExternal,
    cloudMyPaginationScopeKey,
    cloudMySessionsVisibleCount,
    setCloudMyPagination,
    resetCloudMyPagination,
    cloudSignedInIdentity,
    handleCloudSignIn,
  } = useWorkstationSidebarScopeAndPagination({
    sessions,
    workstationSearchQuery: sidebarSearchQueries.workstation,
  });

  const [groupVisibleCounts, setGroupVisibleCounts] = useState<
    Map<string, number>
  >(new Map());
  const [expandedSubagentParentIds, setExpandedSubagentParentIds] = useState<
    Set<string>
  >(() => new Set());
  const [projectsGroupVisibleCounts, setProjectsGroupVisibleCounts] = useState<
    Map<string, number>
  >(new Map());
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set(DEFAULT_COLLAPSED_SECTION_IDS)
  );
  const [projectsCollapsedSectionIds, setProjectsCollapsedSectionIds] =
    useState<Set<string>>(() => new Set());

  const { activeSessionSidebarRevealRequest, revealedSessionIds } =
    useWorkstationSidebarRevealRequestState({
      sessionSidebarRevealRequest,
      activeSessionId,
      clearSessionSidebarReveal,
    });

  const {
    untitledSession,
    newSessionLabel,
    pinFolderLabel,
    unpinFolderLabel,
    createProjectLabel,
    createWorkItemLabel,
    runtimeLabel,
    teamInboxLabel,
    importGithubIssuesLabel,
    addOrgLabel,
    manageOrgLabel,
    searchPlaceholder,
    noSearchResultsTitle,
  } = buildWorkstationSidebarLabels({ t, tProjects, tSessions, tCommon });

  const {
    cloudMenuItems,
    cloudSessionMenuItems,
    channelMenuItems,
    selectedCloudMenuItemId,
    handleCloudSessionItemClick,
    resetCloudTeamPagination,
    handleCloudRemoteItemRemove,
    cloudMemberFilterDropdown,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
    sessionListExcludedIds,
    cloudScopedExtraSessionIds,
    cloudChannelsDialogs,
  } = useWorkstationSidebarCloudMenuData({
    activeCloudOrgId,
    sessions,
    cloudSessionFilter,
    activeSessionId,
    cloudMySessionsVisibleCount,
    revealedCloudOrgId: activeSessionSidebarRevealRequest?.cloudOrgId,
    revealedSidebarItemId: activeSessionSidebarRevealRequest?.sidebarItemId,
    handleCloudSessionFilterChange,
    personalHiddenCloudTaggedIds,
    cloudTaggedSessionIds,
  });

  // Local-scope Channels (this-machine, single-user): the mirror of the
  // cloud channels section, mounted only while no cloud org is active.
  const {
    localChannelsMenuItems,
    handleLocalChannelsItemClick,
    selectedLocalChannelMenuItemId,
    localChannelsDialogs,
  } = useLocalChannelsSection({ enabled: activeCloudOrgId === null });

  // Local channel rows resolve first (their ids can never collide with
  // session/cloud ids) — the cloudMenuData composition idiom.
  const handleScopedSessionItemClick = useCallback(
    (item: NavigationMenuItem): boolean =>
      handleLocalChannelsItemClick(item) || handleCloudSessionItemClick(item),
    [handleLocalChannelsItemClick, handleCloudSessionItemClick]
  );

  const {
    menuItems,
    sessionMap,
    subagentParentIds,
    isLoadMoreId,
    getLoadMoreGroupId,
    projectsWorkItemMenuItems,
    projectsProjectMap,
    projectsWorkItemMap,
    projectsLinearWorkItemMap,
    projectsLocalOrgMap,
    projectsLinearOrgMap,
    projectsWorkItemsLoading,
    projectsLinkedSessionIds,
    getProjectsLoadMoreGroupId,
    loadProjectsLinearOrgWorkItems,
    toChatPanelProject,
    toChatPanelWorkItem,
    openProjectsLinearOrg,
    openProjectsLinearWorkItem,
  } = useWorkstationSidebarSessionAndProjectMenuItems({
    sortedSessions,
    visitedSessions,
    repoPathToName,
    groupByMode,
    untitledSession,
    workstationSearchQuery: sidebarSearchQueries.workstation,
    sessionFilterOrgIds,
    cloudScopedExtraSessionIds,
    sessionListExcludedIds,
    includeExternal,
    groupVisibleCounts,
    activeCloudOrgId,
    expandedSubagentParentIds,
    revealedSessionIds,
    activeSidebarKey,
    workItemsContentVisible,
    projectsGroupVisibleCounts,
    projectsSearchQuery: sidebarSearchQueries.projects,
    activeProjectOrgId,
  });

  const {
    rename,
    activeChatPanelTab,
    highlightedSessionId,
    pinnedMenuItems,
    sessionSidebarMenuItems,
    loadedCloudMySessionRowCount,
    revealCandidateMenuItems,
  } = useWorkstationSidebarPinnedAndRevealData({
    activeSessionId,
    cloudMenuItems,
    menuItems,
    sessionCreatorDrafts,
    projectsSidebarVisible,
    activeSidebarKey,
    createProjectLabel,
    createWorkItemLabel,
    importGithubIssuesLabel,
    newSessionLabel,
    runtimeLabel,
    teamInboxLabel,
    teamInboxUnreadCount,
    t,
    tSessions,
  });

  useWorkstationSidebarRevealNavigationEffects({
    sessionSidebarRevealRequest,
    setSidebarCollapsed,
    setActiveSidebarKey,
    setWorkItemsOpen,
    setChannelsOpen,
    setSelectedOrgId,
    setSidebarSearchQueries,
    setExpandedSubagentParentIds,
    activeSessionSidebarRevealRequest,
    revealCandidateMenuItems,
    setCollapsedSectionIds,
  });

  const {
    resetWorkManagementStateForProjectsContent,
    projectsSidebarMenuItems,
    selectedMenuItemId,
    resolvedCollapsedSectionIds,
    resolvedOnCollapsedSectionIdsChange,
    activateMyStationRouteForProjectsContent,
    activateMyStationRouteForProjectTabContent,
    handleGoToNewSession,
  } = useWorkstationSidebarSelectionAndNavigation({
    setStationMode,
    setStationChatVisible,
    openStartPageTab,
    t,
    projectsWorkItemMenuItems,
    activeSessionCreatorDraftId,
    highlightedSessionId,
    activeSidebarKey,
    activeChatPanelTabType: activeChatPanelTab?.type ?? null,
    chatPanelContentMode,
    chatPanelCreateTarget,
    chatPanelSelectedProject,
    chatPanelSelectedWorkItem,
    projectsSelectedMenuItemId,
    sessionCreatorDrafts,
    workItemsContentVisible,
    activeWorkManagementSection,
    workManagementProjectsView,
    setGroupVisibleCounts,
    collapsedSectionIds,
    groupByMode,
    resetCloudTeamPagination,
    resetCloudMyPagination,
    setCollapsedSectionIds,
    setProjectsGroupVisibleCounts,
    projectsCollapsedSectionIds,
    setProjectsCollapsedSectionIds,
    location,
    navigate,
    goToNewSession,
    navigateChatPanel,
    setChatPanelCreateTarget,
  });

  const {
    handleDeleteSession,
    handleExportMarkdown,
    handleMenuItemClick,
    handleTogglePin,
    handleOpenInNewTab,
    handleOpenInMyStation,
    handleOpenLinkedWorkItemSession,
    handleToggleSubagentExpansion,
  } = useWorkstationSidebarSessionInteractionHandlers({
    handleCloudSessionItemClick: handleScopedSessionItemClick,
    cloudMySessionsVisibleCount,
    cloudMyPaginationScopeKey,
    setCloudMyPagination,
    loadedCloudMySessionRowCount,
    sessionPagination,
    activeSessionId,
    sessionMap,
    isLoadMoreId,
    getLoadMoreGroupId,
    sessionRouteLabel: t("routes.session"),
    handleGoToNewSession,
    navigateTo,
    openSession,
    promoteActiveSessionCreatorDraft,
    groupByMode,
    setGroupVisibleCounts,
    tCommon,
    activateChatPanelTab,
    openOrReplaceSessionInChatPanelTab,
    closeAndDestroyChatPanelTab,
    activateMyStationRouteForProjectTabContent,
    navigateChatPanel,
    openSessionInNewChatTab,
    openSessionInWorkstation,
    setExpandedSubagentParentIds,
  });

  const {
    moveToOrg,
    cloudSyncLevel,
    cloudShare,
    handleMenuItemContextMenu,
    sidebarMenuItems,
    handleProjectsMenuItemClick,
  } = useWorkstationSidebarMenuDecoration({
    sessionMap,
    rename,
    handleDeleteSession,
    deleteSessionCreatorDraft,
    handleExportMarkdown,
    handleOpenInNewTab,
    handleOpenInMyStation,
    handleTogglePin,
    handleToggleSubagentExpansion,
    handleCloudRemoteItemRemove,
    t,
    tCommon,
    activeSessionMoreMenuId,
    expandedSubagentParentIds,
    pinFolderLabel,
    unpinFolderLabel,
    setActiveSessionMoreMenuId,
    subagentParentIds,
    cloudSessionMenuItems,
    channelSidebarMenuItems:
      channelMenuItems.length > 0 ? channelMenuItems : localChannelsMenuItems,
    channelSidebarVisible,
    sessionSidebarMenuItems,
    cloudMySessionsVisibleCount,
    activeSidebarKey,
    workItemsContentVisible,
    projectsSidebarMenuItems,
    activateMyStationRouteForProjectTabContent,
    activateMyStationRouteForProjectsContent,
    getProjectsLoadMoreGroupId,
    loadProjectsLinearOrgWorkItems,
    openProjectsLinearOrg,
    openProjectsLinearWorkItem,
    projectsLinearOrgMap,
    projectsLinearWorkItemMap,
    projectsLocalOrgMap,
    projectsProjectMap,
    projectsWorkItemMap,
    projectsLinkedSessionIds,
    handleOpenLinkedWorkItemSession,
    resetWorkManagementStateForProjectsContent,
    setProjectsGroupVisibleCounts,
    setProjectsSelectedMenuItemId,
    toChatPanelProject,
    toChatPanelWorkItem,
  });

  const {
    handleOpenSpotlight,
    sidebarOrgSelector,
    resolvedMenuItemClick,
    resolvedMenuItemContextMenu,
    resolvedRenderMenuItemWrapper,
  } = useWorkstationSidebarChrome({
    activeOrgId,
    orgSelectorOptions,
    addOrgLabel,
    cloudSignedInIdentity,
    manageOrgLabel,
    handleCloudSignIn,
    activeSidebarKey,
    workItemsContentVisible,
    handleMenuItemContextMenu,
    resetWorkManagementStateForProjectsContent,
    setProjectsSelectedMenuItemId,
    openCreateTargetInStartPage,
    t,
    setSelectedOrgId,
    activeCloudOrgId,
    manageableCloudOrg,
    manageableLocalOrg,
    openOrganizationTab,
    sessionMap,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
    projectsLinearWorkItemMap,
    projectsWorkItemMap,
    tSessions,
    setWorkManagementProjectsView,
    openWorkManagementTab,
    openRuntimeTab,
    runtimeLabel,
    openTeamInboxTab,
    teamInboxLabel,
    activateChatPanelTab,
    handleMenuItemClick,
    handleProjectsMenuItemClick,
    handleOpenInNewTab,
  });

  const { isLoading, sidebarBottomRightActions, resolvedSelectedMenuItemId } =
    useWorkstationSidebarBottomActions({
      sidebarMenuItems,
      resolvedOnCollapsedSectionIdsChange,
      sessions,
      workItemsContentVisible,
      channelSidebarVisible,
      activeSidebarKey,
      projectsWorkItemsLoading,
      projectsSidebarMenuItems,
      sessionsLoading,
      groupByMode,
      includeExternal,
      setGroupByMode,
      setIncludeExternal,
      // In the local scope `selectedCloudMenuItemId` is null, so the open
      // local-channel row lands in the same slot the cloud section uses.
      selectedCloudMenuItemId:
        selectedLocalChannelMenuItemId ?? selectedCloudMenuItemId,
      selectedMenuItemId,
      activeSessionId,
      collapsedSectionIds,
      pinnedMenuItems: channelSidebarVisible ? [] : pinnedMenuItems,
    });

  const handleGuideSetUpTeam = useCallback(() => {
    openCreateTargetInStartPage({
      target: CHAT_PANEL_CREATE_TARGET.COLLAB_ORG,
      title: t("routes.launchpad"),
    });
  }, [openCreateTargetInStartPage, t]);

  const handleGuideManageWork = useCallback(() => {
    openWorkManagementTab({
      section: WORK_MANAGEMENT_SECTION.KANBAN,
      title: tSessions("simulator.tabs.kanban"),
    });
  }, [openWorkManagementTab, tSessions]);

  const handleGuideOpenTutorials = useCallback(() => {
    window.dispatchEvent(new CustomEvent(TUTORIALS_OPEN_EVENT));
  }, []);

  const handleGuideOpenQuickSetup = useCallback(() => {
    navigateTo(ROUTES.auth.setup.path);
  }, [navigateTo]);

  const guideCompletion = useMemo<SidebarGuideCompletion>(
    () => ({
      [SIDEBAR_GUIDE_MILESTONE.SESSION]: sessions.length > 0,
      [SIDEBAR_GUIDE_MILESTONE.TEAM]: Boolean(
        manageableCloudOrg || manageableLocalOrg
      ),
      [SIDEBAR_GUIDE_MILESTONE.WORK]: hasProjects,
    }),
    [hasProjects, manageableCloudOrg, manageableLocalOrg, sessions.length]
  );

  const guideScopeLabel = useMemo(() => {
    const activeOption = orgSelectorOptions.find(
      (option) => String(option.value) === String(activeOrgId)
    );
    return typeof activeOption?.label === "string"
      ? activeOption.label
      : t("sidebar.guide.localWorkspace");
  }, [activeOrgId, orgSelectorOptions, t]);

  return (
    <>
      <NavigationSidebar
        items={[]}
        activeKey={activeSidebarKey}
        onChange={() => undefined}
        menuItems={sidebarMenuItems}
        pinnedMenuItems={channelSidebarVisible ? [] : pinnedMenuItems}
        selectedKey={resolvedSelectedMenuItemId}
        onMenuItemClick={resolvedMenuItemClick}
        onMenuItemContextMenu={resolvedMenuItemContextMenu}
        renderMenuItemWrapper={resolvedRenderMenuItemWrapper}
        hostTopBarLeadingContent={sidebarOrgSelector}
        macTopBarFollowingContent={
          <div className="shrink-0 px-3 pt-1">{sidebarOrgSelector}</div>
        }
        preListContent={
          <WorkstationSidebarViewSwitcher
            activeKey={activeViewKey}
            onChange={handleViewChange}
          />
        }
        onAddNew={handleOpenSpotlight}
        addIcon={Search}
        addLabel={tCommon("actions.search")}
        addTooltipContent={
          <SidebarSearchShortcutTooltip
            searchLabel={tCommon("actions.search")}
          />
        }
        beforeAddNewActions={
          <SidebarGuideButton
            completion={guideCompletion}
            scopeLabel={guideScopeLabel}
            onStartSession={handleGoToNewSession}
            onSetUpTeam={handleGuideSetUpTeam}
            onManageWork={handleGuideManageWork}
            onOpenTutorials={handleGuideOpenTutorials}
            onOpenQuickSetup={handleGuideOpenQuickSetup}
          />
        }
        search={{
          value: sidebarSearchQueries[activeSidebarSearchKey],
          filterValue:
            activeSidebarSearchKey === "workstation"
              ? ""
              : sidebarSearchQueries[activeSidebarSearchKey],
          onChange: handleSidebarSearchChange,
          placeholder: searchPlaceholder,
          noResultsTitle: noSearchResultsTitle,
          showInput: false,
        }}
        listTopPadding
        bottomContent={
          <SidebarBottomBar
            leftContent={
              <SidebarMenuSearchInput
                value={sidebarSearchQueries[activeSidebarSearchKey]}
                onChange={handleSidebarSearchChange}
                placeholder={searchPlaceholder}
                compact
              />
            }
            rightActions={sidebarBottomRightActions}
            settingsAction={<SidebarSettingsMenuButton />}
          />
        }
        isLoading={isLoading}
        collapsibleSections
        collapsedSectionIds={resolvedCollapsedSectionIds}
        onCollapsedSectionsChange={resolvedOnCollapsedSectionIdsChange}
        revealMenuItemRequest={
          activeSessionSidebarRevealRequest
            ? {
                key:
                  activeSessionSidebarRevealRequest.sidebarItemId ??
                  activeSessionSidebarRevealRequest.sessionId,
                requestId: activeSessionSidebarRevealRequest.requestId,
              }
            : undefined
        }
      />
      <SidebarDialogs
        cloudChannelsDialogs={cloudChannelsDialogs}
        localChannelsDialogs={localChannelsDialogs}
        cloudMemberFilterDropdown={cloudMemberFilterDropdown}
        cloudShare={cloudShare}
        cloudSyncLevel={cloudSyncLevel}
        moveToOrg={moveToOrg}
        rename={rename}
        sessionMap={sessionMap}
      />
    </>
  );
};
