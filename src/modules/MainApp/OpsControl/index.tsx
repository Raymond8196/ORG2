/**
 * Ops Control pane
 *
 * Reuses the existing `TaskKanban` feature to give a single board view of
 * agent status inside Workstation.
 */
import { useAtomValue } from "jotai";
import { ArrowLeft } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import TaskKanban from "@src/features/TaskKanban";
import { useOpsControlSidebarState } from "@src/hooks/workStation/panels/useWorkStationPanels";
import {
  NoDragRegion,
  SidebarToggleButton,
  WorkStationShell,
  WorkstationHeaderSectionSeparator,
  WorkstationTabHeaderSlotsView,
  WorkstationToolbarTooltip,
  buildPrimarySidebarConfig,
} from "@src/modules/WorkStation/shared";
import { activeOpsControlHomeTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanelAtom";
import {
  OPS_CONTROL_HOME_TAB,
  workstationTabHeaderAtomByHost,
} from "@src/store/workstation";

import GitHubWorkItemsSurface from "./GitHubWorkItemsSurface";
import OpsControlProjectsSurface from "./OpsControlProjectsSurface";
import OpsControlSidebar from "./OpsControlSidebar";
import OpsControlTaskCreator from "./OpsControlTaskCreator";
import "./index.scss";
import { shouldAutoCollapseOpsControlSidebar } from "./opsControlResponsiveLayout";

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
    setPrimarySidebarCollapsed,
    togglePrimarySidebar,
    closePrimarySidebar,
  } = useOpsControlSidebarState();
  const { t } = useTranslation("common");
  const activeHomeTab = useAtomValue(activeOpsControlHomeTabAtom);
  const chatPanelMaximized = useAtomValue(chatPanelMaximizedAtom);
  const headerSlots = useAtomValue(workstationTabHeaderAtomByHost.opsControl);
  const [githubControlsHost, setGitHubControlsHost] =
    React.useState<HTMLDivElement | null>(null);
  const [githubDetailOpen, setGitHubDetailOpen] = React.useState(false);
  const githubDetailBackRef = React.useRef<(() => void) | null>(null);
  const handleGitHubDetailViewChange = React.useCallback(
    (open: boolean, onBack: (() => void) | null) => {
      githubDetailBackRef.current = open ? onBack : null;
      setGitHubDetailOpen(open);
    },
    []
  );
  const [surfaceWidth, setSurfaceWidth] = React.useState(0);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const autoCollapseArmedRef = React.useRef(true);
  const githubControlsHostRef = React.useCallback(
    (node: HTMLDivElement | null) => setGitHubControlsHost(node),
    []
  );
  const githubDetailActive =
    githubDetailOpen &&
    (activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_ISSUES ||
      activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_PRS);

  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const updateWidth = (width: number) => setSurfaceWidth(width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(surface);
    updateWidth(surface.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (chatPanelMaximized) {
      autoCollapseArmedRef.current = true;
      return;
    }

    const isTooNarrow = shouldAutoCollapseOpsControlSidebar({
      surfaceWidth,
      sidebarWidth: primarySidebarWidth,
    });
    if (!isTooNarrow) {
      autoCollapseArmedRef.current = true;
      return;
    }
    if (githubDetailActive) return;
    if (primarySidebarCollapsed) {
      autoCollapseArmedRef.current = false;
      return;
    }
    if (!autoCollapseArmedRef.current) return;

    autoCollapseArmedRef.current = false;
    setPrimarySidebarCollapsed(true);
  }, [
    chatPanelMaximized,
    githubDetailActive,
    primarySidebarCollapsed,
    primarySidebarWidth,
    setPrimarySidebarCollapsed,
    surfaceWidth,
  ]);

  const mainContent = (
    <div className="ops-control-page flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {activeHomeTab === OPS_CONTROL_HOME_TAB.PROJECTS ? (
          <OpsControlProjectsSurface />
        ) : activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_ISSUES ? (
          <GitHubWorkItemsSurface
            scope="issue"
            sidebarHost={githubControlsHost}
            onDetailViewChange={handleGitHubDetailViewChange}
          />
        ) : activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_PRS ? (
          <GitHubWorkItemsSurface
            scope="pr"
            sidebarHost={null}
            onDetailViewChange={handleGitHubDetailViewChange}
          />
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
    collapsed: primarySidebarCollapsed || githubDetailActive,
    size: primarySidebarWidth,
    onSizeChange: setPrimarySidebarWidth,
    onClose: closePrimarySidebar,
    githubControlsHostRef,
  });

  return (
    <div ref={surfaceRef} className="flex h-full min-h-0 w-full flex-col">
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border-2 pl-1.5 pr-2"
        data-testid="ops-control-header"
      >
        <NoDragRegion className="flex shrink-0 items-center gap-px">
          {githubDetailActive ? (
            // In a GitHub detail view the sidebar is force-collapsed, so the
            // toggle has nothing to act on. Swap it for a back button that
            // occupies the same slot with the same styling — a straight
            // replacement (not a dimmed toggle + extra button) so the leading
            // cluster keeps a stable width and the icon doesn't flicker on
            // enter/leave.
            <WorkstationToolbarTooltip label={t("actions.back")}>
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                icon={<ArrowLeft size={14} strokeWidth={2.25} />}
                aria-label={t("actions.back")}
                onClick={() => githubDetailBackRef.current?.()}
              />
            </WorkstationToolbarTooltip>
          ) : (
            <SidebarToggleButton
              collapsed={primarySidebarCollapsed}
              onToggle={togglePrimarySidebar}
              iconSize={14}
              stableListIcon
              showShortcut={false}
            />
          )}
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
