/**
 * Ops Control pane
 *
 * Reuses the existing `TaskKanban` feature to give a single board view of
 * agent status inside Workstation.
 */
import { useAtomValue } from "jotai";
import React from "react";

import TaskKanban from "@src/features/TaskKanban";
import { usePrimarySidebarState } from "@src/hooks/workStation/panels/useWorkStationPanels";
import {
  NoDragRegion,
  SidebarToggleButton,
  WorkStationShell,
  WorkstationHeaderSectionSeparator,
  WorkstationTabHeaderSlotsView,
  buildPrimarySidebarConfig,
} from "@src/modules/WorkStation/shared";
import { activeOpsControlHomeTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  OPS_CONTROL_HOME_TAB,
  workstationTabHeaderAtomByHost,
} from "@src/store/workstation";

import GitHubWorkItemsSurface from "./GitHubWorkItemsSurface";
import OpsControlProjectsSurface from "./OpsControlProjectsSurface";
import OpsControlSidebar from "./OpsControlSidebar";
import OpsControlTaskCreator from "./OpsControlTaskCreator";
import "./index.scss";

function buildOpsControlSidebarConfig({
  collapsed,
  size,
  onSizeChange,
  onClose,
  githubControlsHostRef,
}: {
  collapsed: boolean;
  size: number;
  onSizeChange: (size: number) => void;
  onClose: () => void;
  githubControlsHostRef: React.RefCallback<HTMLDivElement>;
}) {
  return buildPrimarySidebarConfig({
    content: (
      <OpsControlSidebar githubControlsHostRef={githubControlsHostRef} />
    ),
    collapsed,
    size,
    onSizeChange,
    onClose,
  });
}

const OpsControlPage: React.FC = () => {
  const {
    primarySidebarCollapsed,
    primarySidebarWidth,
    setPrimarySidebarWidth,
    togglePrimarySidebar,
    closePrimarySidebar,
  } = usePrimarySidebarState();
  const activeHomeTab = useAtomValue(activeOpsControlHomeTabAtom);
  const headerSlots = useAtomValue(workstationTabHeaderAtomByHost.opsControl);
  const [githubControlsHost, setGitHubControlsHost] =
    React.useState<HTMLDivElement | null>(null);
  const githubControlsHostRef = React.useCallback(
    (node: HTMLDivElement | null) => setGitHubControlsHost(node),
    []
  );

  const mainContent = (
    <div className="ops-control-page flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {activeHomeTab === OPS_CONTROL_HOME_TAB.PROJECTS ? (
          <OpsControlProjectsSurface />
        ) : activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_ISSUES ? (
          <GitHubWorkItemsSurface
            scope="issue"
            sidebarHost={githubControlsHost}
          />
        ) : activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_PRS ? (
          <GitHubWorkItemsSurface scope="pr" sidebarHost={githubControlsHost} />
        ) : (
          <>
            <TaskKanban />
            <OpsControlTaskCreator />
          </>
        )}
      </div>
    </div>
  );

  const primarySidebarConfig = buildOpsControlSidebarConfig({
    collapsed: primarySidebarCollapsed,
    size: primarySidebarWidth,
    onSizeChange: setPrimarySidebarWidth,
    onClose: closePrimarySidebar,
    githubControlsHostRef,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border-2 pl-1.5 pr-2"
        data-testid="ops-control-header"
      >
        <NoDragRegion className="flex shrink-0 items-center gap-px">
          <SidebarToggleButton
            collapsed={primarySidebarCollapsed}
            onToggle={togglePrimarySidebar}
            iconSize={14}
            stableListIcon
          />
        </NoDragRegion>
        <WorkstationHeaderSectionSeparator />
        <WorkstationTabHeaderSlotsView slots={headerSlots} />
      </div>
      <div className="min-h-0 flex-1">
        <WorkStationShell
          primarySidebarConfig={primarySidebarConfig}
          content={mainContent}
          statusBar={null}
          appClassName="ops-control-workstation"
        />
      </div>
    </div>
  );
};

export default OpsControlPage;
