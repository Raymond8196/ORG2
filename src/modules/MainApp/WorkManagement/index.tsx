/**
 * Kanban pane
 *
 * Reuses the existing `TaskKanban` feature to give a single board view of
 * agent status inside Workstation.
 *
 * Two host contexts:
 *   - Chat pane (default): republishes its controls into the chat shell's
 *     shared 40px published-header row.
 *   - WorkStation tab (`embedded`): the WorkStation already renders the shared
 *     40px `WorkstationTabHeader`, so we suppress our own header row and instead
 *     republish the same controls into the `code` host slot — avoiding a
 *     duplicate header bar.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { usePublishChatPanelHeader } from "@src/engines/ChatPanel/header";
import FactoryViewPill from "@src/features/TaskKanban/components/FactoryViewPill";
import KanbanOrgScopeSelect from "@src/features/TaskKanban/components/KanbanOrgScopeSelect";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import {
  WorkstationHeaderSectionSeparator,
  WorkstationToolbarTooltip,
} from "@src/modules/WorkStation/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
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

export interface WorkManagementPageProps {
  /**
   * When true, the pane is hosted inside a WorkStation tab that already renders
   * the shared 40px header. The pane hides its own header row and republishes
   * its controls into the `code` host slot instead.
   */
  embedded?: boolean;
}

const WorkManagementPage: React.FC<WorkManagementPageProps> = ({
  embedded = false,
}) => {
  const { t } = useTranslation("common");
  const activeHomeTab = useAtomValue(activeWorkManagementSectionAtom);
  const projectsView = useAtomValue(workManagementProjectsViewAtom);
  const setProjectsView = useSetAtom(workManagementProjectsViewAtom);
  const setActiveWorkManagementSection = useSetAtom(
    setActiveWorkManagementSectionAtom
  );
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

  const showViewSwitch =
    activeHomeTab === WORK_MANAGEMENT_SECTION.KANBAN && !githubDetailActive;
  const activeDataset = resolveWorkManagementDataset({
    section: activeHomeTab,
    projectsView,
  });
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
      setActiveWorkManagementSection({
        section:
          dataset === WORK_MANAGEMENT_DATASET.GITHUB_ISSUES
            ? WORK_MANAGEMENT_SECTION.GITHUB_ISSUES
            : WORK_MANAGEMENT_SECTION.GITHUB_PRS,
      });
    },
    [setActiveWorkManagementSection, setProjectsView]
  );

  // Leading header control: GitHub detail "back" button, else the view-switch
  // pill. Shared by the chat-pane and WorkStation published-header slots.
  const headerLeadingControl = React.useMemo(() => {
    if (githubDetailActive) {
      return (
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
      );
    }
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
  }, [
    activeDataset,
    githubDetailActive,
    handleDatasetChange,
    showViewSwitch,
    t,
  ]);

  const headerLeading = React.useMemo(() => {
    if (!headerLeadingControl) return null;
    return showViewSwitch ? (
      <>
        <KanbanOrgScopeSelect />
        <WorkstationHeaderSectionSeparator />
        {headerLeadingControl}
      </>
    ) : (
      <>
        {headerLeadingControl}
        <WorkstationHeaderSectionSeparator />
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

  // WorkStation embed: publish the pane's controls into the shared 40px bar.
  // Work Management has no shell-owned sidebar, so its content uses the bar's
  // standard left inset without reserving an empty toggle/action gutter.
  const embeddedHeaderContent = React.useMemo(
    () => ({
      content: headerPrimaryContent,
      trailing: headerSlots?.trailing ?? null,
      shellLeadingChromeHidden: true,
      joinWithFollowingRow: headerSlots?.joinWithFollowingRow ?? false,
    }),
    [headerPrimaryContent, headerSlots]
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
    }),
    [headerPrimaryContent, headerSlots]
  );
  usePublishChatPanelHeader({
    content: chatHeaderContent,
    enabled: !embedded,
  });

  const mainContent = (
    <div className="work-management-page flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <React.Suspense
          fallback={<Placeholder variant="loading" fillParentHeight />}
        >
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
        </React.Suspense>
      </div>
    </div>
  );

  return <div className="h-full min-h-0 w-full">{mainContent}</div>;
};

export default WorkManagementPage;
