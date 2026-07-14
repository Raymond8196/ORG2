import { useAtomValue } from "jotai";
import React from "react";

import { useRouteAppMode } from "@src/config/routeViewModeConfig";
import type { AppModeType } from "@src/config/viewModeTypes";
import {
  Dock,
  StationDockChrome,
} from "@src/engines/Simulator/components/Dock";
import { useCurrentTurnLastAgentMessage } from "@src/engines/Simulator/hooks/useCurrentTurnLastAgentMessage";
import {
  useDockFilterUrlSync,
  useWorkStationPanels,
} from "@src/hooks/workStation";
import { GUIDE_TARGETS } from "@src/scaffold/Tutorials/guideTargets";
import { workstationActiveSessionIdAtom } from "@src/store/session";
import {
  CHAT_PANEL_SURFACE_KIND,
  activeChatPanelSurfaceAtom,
} from "@src/store/ui/chatPanelAtom";
import { simulatorCaptionBarEnabledAtom } from "@src/store/ui/simulatorAtom";
import {
  workStationDockAutoHideAtom,
  workStationFollowAgentHighlightEnabledAtom,
  workStationPrimarySidebarCollapsedAtom,
  workStationStatusBarHiddenAtom,
  workStationTitleBarHiddenAtom,
} from "@src/store/ui/workStationAtom";

import { StatusBarRenderer } from "../shared/StatusBar/StatusBarRenderer";
import { WorkspacePortScanner } from "../shared/StatusBar/WorkspacePortScanner";
import { useWorkspacePortAdvertisedUrls } from "../shared/StatusBar/utils/useWorkspacePortAdvertisedUrls";
import AgentStationChromeFrame from "./AgentStationChromeFrame";
import AgentStationTopHeader from "./AgentStationTopHeader";
import { AppShellContent } from "./AppShellContent";
import WorkstationTabBar from "./WorkstationTabBar";
import WorkstationTabHeader from "./WorkstationTabHeader";
import { useAppShellActions } from "./hooks/useAppShellActions";
import { useAppShellDerivedState } from "./hooks/useAppShellDerivedState";
import { useAppShellDock } from "./hooks/useAppShellDock";
import { useAppShellDockFilterSync } from "./hooks/useAppShellDockFilterSync";
import { useAppShellRepo } from "./hooks/useAppShellRepo";
import { useAppShellSimulatorPanelSync } from "./hooks/useAppShellSimulatorPanelSync";
import { useAppShellStationMode } from "./hooks/useAppShellStationMode";
import { useAppShellStatusBar } from "./hooks/useAppShellStatusBar";
import { useMyStationDockSegments } from "./hooks/useMyStationDockSegments";

interface AppShellProps {
  /** Whether WorkStation is currently visible (code view mode is active) */
  isActive?: boolean;
  /** Whether the chat panel is taking over the WorkStation surface */
  chatPanelFocused?: boolean;
}

const AppShell = React.memo(
  ({ isActive = true, chatPanelFocused = false }: AppShellProps) => {
    const appMode = useRouteAppMode();
    const _titleBarHidden = useAtomValue(workStationTitleBarHiddenAtom);
    const statusBarHidden = useAtomValue(workStationStatusBarHiddenAtom);
    const dockAutoHide = useAtomValue(workStationDockAutoHideAtom);
    const followAgentHighlightEnabled = useAtomValue(
      workStationFollowAgentHighlightEnabledAtom
    );
    const primaryPanelCollapsed = useAtomValue(
      workStationPrimarySidebarCollapsedAtom
    );
    const captionEnabled = useAtomValue(simulatorCaptionBarEnabledAtom);
    const captionMessage = useCurrentTurnLastAgentMessage();
    const workstationActiveSessionId = useAtomValue(
      workstationActiveSessionIdAtom
    );
    const chatPanelSurface = useAtomValue(activeChatPanelSurfaceAtom);
    const hideWorkstationDockForChatPanel =
      chatPanelFocused &&
      (chatPanelSurface.kind === CHAT_PANEL_SURFACE_KIND.PROJECT ||
        chatPanelSurface.kind === CHAT_PANEL_SURFACE_KIND.PROJECT_ORG ||
        chatPanelSurface.kind === CHAT_PANEL_SURFACE_KIND.WORK_ITEM);

    const { repoPath, repoName, pathExists, lastSeenPath } = useAppShellRepo();
    const { visitedModes, handleDockClick } = useAppShellDock();
    const dockFilter = useAppShellDockFilterSync();
    useDockFilterUrlSync();
    const myStationDockSegments = useMyStationDockSegments();
    const activeDockApp = dockFilter === "all" ? "all" : dockFilter;

    const {
      isAgentStation,
      hasVisitedAgentStation,
      illuminateAgentStationChrome,
    } = useAppShellStationMode({ followAgentHighlightEnabled });

    const agentStationCaptionVisible =
      isAgentStation &&
      captionEnabled &&
      !!captionMessage &&
      !!workstationActiveSessionId;

    const workStationPanels = useWorkStationPanels();
    useAppShellSimulatorPanelSync({ isAgentStation, workStationPanels });

    const { handleSelectRepo, handleOpenSettings } = useAppShellActions();

    const {
      effectiveHost,
      isCodeMode,
      isBrowserMode,
      isProjectMode,
      codeContentVisible,
      browserContentVisible,
      projectContentVisible,
    } = useAppShellDerivedState({
      dockFilter,
    });

    const hasVisitedCode = visitedModes.has("code");
    const hasVisitedBrowser = visitedModes.has("browser");
    const hasVisitedProject = visitedModes.has("project");

    const showCodeEditorBottomPanelToggle =
      codeContentVisible && !isAgentStation;
    const showSettingsButton =
      (codeContentVisible || projectContentVisible) && !isAgentStation;

    useAppShellStatusBar({
      primaryPanelCollapsed,
      showSettingsButton,
      showCodeEditorBottomPanelToggle,
      handleOpenSettings,
      workStationPanels,
    });

    const portsEnabled = isCodeMode && isActive && !isAgentStation;
    useWorkspacePortAdvertisedUrls(portsEnabled);

    const showStatusBar = !statusBarHidden && !isAgentStation;
    return (
      <div className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-workstation-bg">
        {isAgentStation && <AgentStationTopHeader />}
        <AgentStationChromeFrame
          enabled={followAgentHighlightEnabled && isAgentStation}
          illuminated={illuminateAgentStationChrome}
          captionVisible={agentStationCaptionVisible}
          hasSession={!!workstationActiveSessionId}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!isAgentStation && (
              <div data-guide-target={GUIDE_TARGETS.WORKSTATION_TAB_BAR}>
                <WorkstationTabBar
                  appMode={
                    (effectiveHost === "code" ||
                    effectiveHost === "browser" ||
                    effectiveHost === "project"
                      ? effectiveHost
                      : appMode) as AppModeType
                  }
                />
              </div>
            )}
            {!isAgentStation && (
              <div data-guide-target={GUIDE_TARGETS.WORKSTATION_TAB_HEADER}>
                <WorkstationTabHeader />
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AppShellContent
                repoPath={repoPath}
                repoName={repoName}
                pathExists={pathExists}
                lastSeenPath={lastSeenPath}
                isActive={isActive}
                chatPanelFocused={chatPanelFocused}
                isAgentStation={isAgentStation}
                hasVisitedAgentStation={hasVisitedAgentStation}
                hasVisitedCode={hasVisitedCode}
                hasVisitedBrowser={hasVisitedBrowser}
                hasVisitedProject={hasVisitedProject}
                isCodeMode={isCodeMode}
                isBrowserMode={isBrowserMode}
                isProjectMode={isProjectMode}
                codeContentVisible={codeContentVisible}
                browserContentVisible={browserContentVisible}
                projectContentVisible={projectContentVisible}
                handleSelectRepo={handleSelectRepo}
              />
            </div>
          </div>
          {portsEnabled && <WorkspacePortScanner enabled />}
          {showStatusBar && <StatusBarRenderer />}
          {!isAgentStation && !hideWorkstationDockForChatPanel && (
            <StationDockChrome autoHide={dockAutoHide} showTopBorder>
              <div data-guide-target={GUIDE_TARGETS.WORKSTATION_DOCK}>
                <Dock
                  segments={myStationDockSegments}
                  activeApp={activeDockApp}
                  onAppClick={handleDockClick}
                />
              </div>
            </StationDockChrome>
          )}
        </AgentStationChromeFrame>
      </div>
    );
  }
);

AppShell.displayName = "AppShell";

export default AppShell;
