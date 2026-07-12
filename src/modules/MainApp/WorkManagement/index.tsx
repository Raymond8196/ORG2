/**
 * Kanban pane
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
import FactoryViewPill from "@src/features/TaskKanban/components/FactoryViewPill";
import {
  NoDragRegion,
  WorkstationHeaderSectionSeparator,
  WorkstationTabHeaderSlotsView,
  WorkstationToolbarTooltip,
} from "@src/modules/WorkStation/shared";
import { activeWorkManagementSectionAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  WORK_MANAGEMENT_SECTION,
  workstationTabHeaderAtomByHost,
} from "@src/store/workstation";

import GitHubWorkItemsSurface from "./GitHubWorkItemsSurface";
import WorkManagementProjectsSurface from "./WorkManagementProjectsSurface";
import WorkManagementTaskCreator from "./WorkManagementTaskCreator";
import "./index.scss";

const WorkManagementPage: React.FC = () => {
  const { t } = useTranslation("common");
  const activeHomeTab = useAtomValue(activeWorkManagementSectionAtom);
  const headerSlots = useAtomValue(
    workstationTabHeaderAtomByHost.workManagement
  );
  const [githubDetailOpen, setGitHubDetailOpen] = React.useState(false);
  const githubDetailBackRef = React.useRef<(() => void) | null>(null);
  const handleGitHubDetailViewChange = React.useCallback(
    (open: boolean, onBack: (() => void) | null) => {
      githubDetailBackRef.current = open ? onBack : null;
      setGitHubDetailOpen(open);
    },
    []
  );
  const githubDetailActive =
    githubDetailOpen &&
    (activeHomeTab === WORK_MANAGEMENT_SECTION.GITHUB_ISSUES ||
      activeHomeTab === WORK_MANAGEMENT_SECTION.GITHUB_PRS);

  const mainContent = (
    <div className="work-management-page flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {activeHomeTab === WORK_MANAGEMENT_SECTION.PROJECTS ? (
          <WorkManagementProjectsSurface />
        ) : activeHomeTab === WORK_MANAGEMENT_SECTION.GITHUB_ISSUES ? (
          <GitHubWorkItemsSurface
            scope="issue"
            onDetailViewChange={handleGitHubDetailViewChange}
          />
        ) : activeHomeTab === WORK_MANAGEMENT_SECTION.GITHUB_PRS ? (
          <GitHubWorkItemsSurface
            scope="pr"
            onDetailViewChange={handleGitHubDetailViewChange}
          />
        ) : (
          <>
            <TaskKanban />
            <WorkManagementTaskCreator />
          </>
        )}
      </div>
    </div>
  );

  const showViewSwitch =
    activeHomeTab === WORK_MANAGEMENT_SECTION.KANBAN && !githubDetailActive;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border-2 pl-1.5 pr-2"
        data-testid="work-management-header"
      >
        {(githubDetailActive || showViewSwitch) && (
          <NoDragRegion className="flex shrink-0 items-center gap-px">
            {githubDetailActive ? (
              // Detail navigation owns the leading header slot while the list
              // view switch is hidden, keeping the 40px strip stable.
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
              <FactoryViewPill />
            )}
          </NoDragRegion>
        )}
        {(githubDetailActive || showViewSwitch) && (
          <WorkstationHeaderSectionSeparator />
        )}
        <WorkstationTabHeaderSlotsView slots={headerSlots} />
      </div>
      <div className="min-h-0 flex-1">{mainContent}</div>
    </div>
  );
};

export default WorkManagementPage;
