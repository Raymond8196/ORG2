/**
 * Kanban pane
 *
 * Reuses the existing `TaskKanban` feature to give a single board view of
 * agent status inside Workstation.
 *
 * Two host contexts:
 *   - Chat pane (default): uses the Chat Panel tab bar and its published row.
 *   - WorkStation tab (`embedded`): uses the WorkStation tab bar and its
 *     published row. In either host, split surfaces move this chrome into
 *     their own left-column header rows and hide the shell-wide strip.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";

import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import { Placeholder } from "@src/components/Placeholder";
import { usePublishChatPanelHeader } from "@src/engines/ChatPanel/header";
import FactoryViewPill from "@src/features/TaskKanban/components/FactoryViewPill";
import KanbanOrgScopeSelect from "@src/features/TaskKanban/components/KanbanOrgScopeSelect";
import { usePublishWorkstationTabHeader } from "@src/hooks/tabHost/useWorkstationTabHeader";
import {
  activeWorkManagementSectionAtom,
  setActiveWorkManagementSectionAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  WORK_MANAGEMENT_PROJECTS_VIEW,
  WORK_MANAGEMENT_SECTION,
  workManagementProjectsViewAtom,
  workstationTabHeaderAtomByHost,
} from "@src/store/workstation";

import { WorkManagementDatasetSwitch } from "./WorkManagementDatasetSwitch";
import "./index.scss";
import {
  WORK_MANAGEMENT_DATASET,
  type WorkManagementDataset,
  resolveWorkManagementDataset,
} from "./workManagementDataset";
import {
  WorkManagementSplitHeaderContext,
  shouldHideWorkManagementHostHeader,
} from "./workManagementSplitHeaderContext";

const TaskKanban = React.lazy(() => import("@src/features/TaskKanban"));
const GitHubWorkItemsSurface = React.lazy(
  () => import("./GitHubWorkItemsSurface")
);
const WorkManagementProjectsSurface = React.lazy(
  () => import("./WorkManagementProjectsSurface")
);
const WorkManagementTaskCreator = React.lazy(
  () => import("./WorkManagementTaskCreator")
);
const ConnectedTeamInboxView = React.lazy(
  () => import("@src/modules/MainApp/TeamInbox/ConnectedTeamInboxView")
);
const RoutineRunsSurface = React.lazy(() => import("./RoutineRunsSurface"));

interface WorkManagementPageProps {
  /**
   * When true, the pane is hosted inside a WorkStation tab. Non-split surfaces
   * use its shared header; split surfaces render their controls in the left
   * column and hide that shell-wide row.
   */
  embedded?: boolean;
  /** Whether the host currently renders a tab row above this surface. */
  hasTabBar?: boolean;
}

const WorkManagementPage: React.FC<WorkManagementPageProps> = ({
  embedded = false,
  hasTabBar = true,
}) => {
  const activeHomeTab = useAtomValue(activeWorkManagementSectionAtom);
  const projectsView = useAtomValue(workManagementProjectsViewAtom);
  const setProjectsView = useSetAtom(workManagementProjectsViewAtom);
  const setActiveWorkManagementSection = useSetAtom(
    setActiveWorkManagementSectionAtom
  );
  const headerSlots = useAtomValue(
    workstationTabHeaderAtomByHost.workManagement
  );
  const showViewSwitch = activeHomeTab === WORK_MANAGEMENT_SECTION.KANBAN;
  const activeDataset = resolveWorkManagementDataset({
    section: activeHomeTab,
    projectsView,
  });
  const detailHost = embedded ? "workstation" : "chat";
  const handleDatasetChange = React.useCallback(
    (dataset: WorkManagementDataset) => {
      if (dataset === WORK_MANAGEMENT_DATASET.PROJECTS) {
        setProjectsView(WORK_MANAGEMENT_PROJECTS_VIEW.PROJECTS);
        setActiveWorkManagementSection({
          section: WORK_MANAGEMENT_SECTION.PROJECTS,
        });
        return;
      }
      if (dataset === WORK_MANAGEMENT_DATASET.WORK_ITEMS) {
        setProjectsView(WORK_MANAGEMENT_PROJECTS_VIEW.WORK_ITEMS);
        setActiveWorkManagementSection({
          section: WORK_MANAGEMENT_SECTION.PROJECTS,
        });
        return;
      }
      if (dataset === WORK_MANAGEMENT_DATASET.INBOX) {
        setActiveWorkManagementSection({
          section: WORK_MANAGEMENT_SECTION.INBOX,
        });
        return;
      }
      setActiveWorkManagementSection({
        section:
          dataset === WORK_MANAGEMENT_DATASET.GITHUB_ISSUES
            ? WORK_MANAGEMENT_SECTION.GITHUB_ISSUES
            : WORK_MANAGEMENT_SECTION.GITHUB_PRS,
      });
    },
    [setActiveWorkManagementSection, setProjectsView]
  );

  // Leading header control shared by the chat-pane and WorkStation slots.
  const headerLeadingControl = React.useMemo(() => {
    if (showViewSwitch) {
      return <FactoryViewPill />;
    }
    if (activeDataset) {
      return (
        <WorkManagementDatasetSwitch
          activeDataset={activeDataset}
          onChange={handleDatasetChange}
        />
      );
    }
    return null;
  }, [activeDataset, handleDatasetChange, showViewSwitch]);

  // A split list owns its own compact header. Keep its dataset switch to the
  // selected icon and chevron while the shell header retains the readable
  // dataset title for non-split presentations.
  const splitDatasetControl = React.useMemo(() => {
    if (!activeDataset || showViewSwitch) return null;
    return (
      <WorkManagementDatasetSwitch
        activeDataset={activeDataset}
        onChange={handleDatasetChange}
        compact
      />
    );
  }, [activeDataset, handleDatasetChange, showViewSwitch]);

  const headerLeading = React.useMemo(() => {
    if (!headerLeadingControl) return null;
    return showViewSwitch ? (
      <>
        <KanbanOrgScopeSelect />
        <HeaderSectionSeparator />
        {headerLeadingControl}
      </>
    ) : (
      <>
        {headerLeadingControl}
        <HeaderSectionSeparator />
      </>
    );
  }, [headerLeadingControl, showViewSwitch]);

  const headerPrimaryContent = React.useMemo(() => {
    if (!headerLeading && !headerSlots?.content) return null;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {headerLeading}
        {headerSlots?.content}
      </div>
    );
  }, [headerLeading, headerSlots?.content]);

  // WorkStation embed: publish the pane's controls into the shared 36px bar.
  // Work Management has no shell-owned sidebar, so its content uses the bar's
  // standard left inset without reserving an empty toggle/action gutter.
  const publishedHeaderHidden = shouldHideWorkManagementHostHeader(
    hasTabBar,
    headerSlots?.hidden ?? false
  );
  const embeddedHeaderContent = React.useMemo(
    () => ({
      content: headerPrimaryContent,
      trailing: headerSlots?.trailing ?? null,
      shellLeadingChromeHidden: true,
      joinWithFollowingRow: headerSlots?.joinWithFollowingRow ?? false,
      hidden: publishedHeaderHidden,
    }),
    [headerPrimaryContent, headerSlots, publishedHeaderHidden]
  );
  usePublishWorkstationTabHeader({
    host: "code",
    content: embeddedHeaderContent,
    enabled: embedded,
  });

  const chatHeaderContent = React.useMemo(
    () => ({
      content: headerPrimaryContent,
      trailing: headerSlots?.trailing ?? null,
      joinWithFollowingRow: headerSlots?.joinWithFollowingRow ?? false,
      hidden: publishedHeaderHidden,
    }),
    [headerPrimaryContent, headerSlots, publishedHeaderHidden]
  );
  usePublishChatPanelHeader({
    content: chatHeaderContent,
    enabled: !embedded,
  });

  const mainContent = (
    <div className="work-management-page flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <React.Suspense
          fallback={
            <Placeholder
              variant="loading"
              placement="detail-panel"
              fillParentHeight
            />
          }
        >
          {activeHomeTab === WORK_MANAGEMENT_SECTION.PROJECTS ? (
            <WorkManagementProjectsSurface detailHost={detailHost} />
          ) : activeHomeTab === WORK_MANAGEMENT_SECTION.INBOX ? (
            <ConnectedTeamInboxView />
          ) : activeHomeTab === WORK_MANAGEMENT_SECTION.GITHUB_ISSUES ? (
            <GitHubWorkItemsSurface scope="issue" detailHost={detailHost} />
          ) : activeHomeTab === WORK_MANAGEMENT_SECTION.GITHUB_PRS ? (
            <GitHubWorkItemsSurface scope="pr" detailHost={detailHost} />
          ) : activeHomeTab === WORK_MANAGEMENT_SECTION.RUNS ? (
            <RoutineRunsSurface />
          ) : (
            <>
              <TaskKanban />
              <WorkManagementTaskCreator />
            </>
          )}
        </React.Suspense>
      </div>
    </div>
  );

  const splitHeaderContextValue = React.useMemo(
    () => ({
      hasTabBar,
      datasetControl: headerLeadingControl,
      splitDatasetControl,
    }),
    [hasTabBar, headerLeadingControl, splitDatasetControl]
  );

  return (
    <WorkManagementSplitHeaderContext.Provider value={splitHeaderContextValue}>
      <div className="h-full min-h-0 w-full">{mainContent}</div>
    </WorkManagementSplitHeaderContext.Provider>
  );
};

export default WorkManagementPage;
