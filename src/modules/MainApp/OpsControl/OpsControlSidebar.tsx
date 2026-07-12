import { useAtomValue, useSetAtom } from "jotai";
import {
  Boxes,
  CircleDot,
  Columns3,
  GitPullRequest,
  List,
  ListTodo,
  NotebookTabs,
  Radar,
} from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import type { VirtuosoHandle } from "react-virtuoso";

import { TREE_ROW_HEIGHT, TreeRowBase } from "@src/components/TreeRow";
import {
  type FlattenedTreeNode,
  VirtualizedStickyTree,
} from "@src/components/VirtualizedStickyTree";
import {
  type FactoryViewMode,
  parseFactoryViewMode,
} from "@src/features/TaskKanban/components/FactoryViewPill";
import {
  PrimarySidebarLayout,
  type PrimarySidebarTab,
} from "@src/modules/WorkStation/shared";
import {
  activeOpsControlHomeTabAtom,
  openOpsControlChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  OPS_CONTROL_HOME_TAB,
  OPS_CONTROL_PROJECTS_VIEW,
  type OpsControlHomeTab,
  type OpsControlProjectsView,
  opsControlProjectsViewAtom,
} from "@src/store/workstation";

const ROW_ICON_SIZE = 14;
const ROW_ICON_STROKE = 1.75;

const OPS_CONTROL_SIDEBAR_NODE_KIND = {
  SessionsView: "sessions-view",
  WorkitemView: "workitem-view",
  ProjectView: "project-view",
  GitHubIssues: "github-issues",
  GitHubPrs: "github-prs",
  Kanban: "kanban",
  List: "list",
  Diary: "diary",
} as const;

type OpsControlSidebarNodeKind =
  (typeof OPS_CONTROL_SIDEBAR_NODE_KIND)[keyof typeof OPS_CONTROL_SIDEBAR_NODE_KIND];

interface OpsControlSidebarNode {
  id: string;
  name: string;
  path: string;
  type: "file";
  icon: React.ReactNode;
  kind: OpsControlSidebarNodeKind;
}

interface OpsControlSidebarRowsProps {
  nodes: FlattenedTreeNode<OpsControlSidebarNode>[];
  activeHomeTab: OpsControlHomeTab;
  activeProjectsView: OpsControlProjectsView;
  activeViewMode: FactoryViewMode;
  onSelectNode: (node: OpsControlSidebarNode) => void;
  emptyMessage: string;
}

const VIEW_MODE_BY_NODE_KIND: Partial<
  Record<OpsControlSidebarNodeKind, FactoryViewMode>
> = {
  [OPS_CONTROL_SIDEBAR_NODE_KIND.Kanban]: "kanban",
  [OPS_CONTROL_SIDEBAR_NODE_KIND.List]: "list",
  [OPS_CONTROL_SIDEBAR_NODE_KIND.Diary]: "diary",
};

const OpsControlSidebarRows: React.FC<OpsControlSidebarRowsProps> = memo(
  ({
    nodes,
    activeHomeTab,
    activeProjectsView,
    activeViewMode,
    onSelectNode,
    emptyMessage,
  }) => {
    const virtuosoRef = React.useRef<VirtuosoHandle>(null);
    const renderItem = useCallback(
      (item: FlattenedTreeNode<OpsControlSidebarNode>) => {
        const { node, depth } = item;
        const viewMode = VIEW_MODE_BY_NODE_KIND[node.kind];
        const isOpsControlHome =
          activeHomeTab === OPS_CONTROL_HOME_TAB.OPS_CONTROL;
        const isProjectsHome = activeHomeTab === OPS_CONTROL_HOME_TAB.PROJECTS;
        const isSelected =
          (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.SessionsView &&
            isOpsControlHome) ||
          (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.WorkitemView &&
            isProjectsHome &&
            activeProjectsView === OPS_CONTROL_PROJECTS_VIEW.WORK_ITEMS) ||
          (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.ProjectView &&
            isProjectsHome &&
            activeProjectsView === OPS_CONTROL_PROJECTS_VIEW.PROJECTS) ||
          (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.GitHubIssues &&
            activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_ISSUES) ||
          (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.GitHubPrs &&
            activeHomeTab === OPS_CONTROL_HOME_TAB.GITHUB_PRS) ||
          (isOpsControlHome && viewMode === activeViewMode);
        const handleClick = () => onSelectNode(node);

        return (
          <TreeRowBase
            node={node}
            depth={depth}
            isSelected={isSelected}
            onClick={handleClick}
            dataPath={node.path}
          />
        );
      },
      [activeHomeTab, activeProjectsView, activeViewMode, onSelectNode]
    );

    return (
      <VirtualizedStickyTree
        flattenedNodes={nodes}
        rowHeight={TREE_ROW_HEIGHT}
        renderItem={renderItem}
        virtuosoRef={virtuosoRef}
        emptyMessage={emptyMessage}
      />
    );
  }
);

OpsControlSidebarRows.displayName = "OpsControlSidebarRows";

const OpsControlSidebar: React.FC = memo(() => {
  const { t } = useTranslation(["sessions", "common", "navigation"]);
  const location = useLocation();
  const navigate = useNavigate();
  const activeHomeTab = useAtomValue(activeOpsControlHomeTabAtom);
  const activeProjectsView = useAtomValue(opsControlProjectsViewAtom);
  const setOpsControlProjectsView = useSetAtom(opsControlProjectsViewAtom);
  const openOpsControlTab = useSetAtom(openOpsControlChatPanelTabAtom);
  const activeViewMode = parseFactoryViewMode(location.search);

  const setViewMode = useCallback(
    (viewMode: FactoryViewMode) => {
      const params = new URLSearchParams(location.search);
      if (viewMode === "kanban") {
        params.delete("view");
      } else {
        params.set("view", viewMode);
      }
      const search = params.toString();
      navigate({ search: search ? `?${search}` : "" }, { replace: true });
    },
    [location.search, navigate]
  );

  const manageItemNodes = useMemo<FlattenedTreeNode<OpsControlSidebarNode>[]>(
    () => [
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:sessions-view",
          name: t("sessions:opsControl.sidebar.sessionsView"),
          path: "ops-control-sidebar:sessions-view",
          type: "file",
          icon: <Radar size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />,
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.SessionsView,
        },
      },
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:workitem-view",
          name: t("sessions:opsControl.sidebar.workitemView"),
          path: "ops-control-sidebar:workitem-view",
          type: "file",
          icon: <ListTodo size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />,
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.WorkitemView,
        },
      },
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:project-view",
          name: t("navigation:labels.projects"),
          path: "ops-control-sidebar:project-view",
          type: "file",
          icon: <Boxes size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />,
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.ProjectView,
        },
      },
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:github-issues",
          name: t("sessions:opsControl.sidebar.githubIssues"),
          path: "ops-control-sidebar:github-issues",
          type: "file",
          icon: (
            <CircleDot size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />
          ),
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.GitHubIssues,
        },
      },
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:github-prs",
          name: t("sessions:opsControl.sidebar.githubPrs"),
          path: "ops-control-sidebar:github-prs",
          type: "file",
          icon: (
            <GitPullRequest
              size={ROW_ICON_SIZE}
              strokeWidth={ROW_ICON_STROKE}
            />
          ),
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.GitHubPrs,
        },
      },
    ],
    [t]
  );

  const viewNodes = useMemo<FlattenedTreeNode<OpsControlSidebarNode>[]>(
    () => [
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:kanban",
          name: t("sessions:simulator.tabs.kanban"),
          path: "ops-control-sidebar:kanban",
          type: "file",
          icon: <Columns3 size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />,
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.Kanban,
        },
      },
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:list",
          name: t("sessions:opsControl.view.list"),
          path: "ops-control-sidebar:list",
          type: "file",
          icon: <List size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />,
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.List,
        },
      },
      {
        depth: 0,
        node: {
          id: "ops-control-sidebar:diary",
          name: t("sessions:opsControl.view.diary"),
          path: "ops-control-sidebar:diary",
          type: "file",
          icon: (
            <NotebookTabs size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />
          ),
          kind: OPS_CONTROL_SIDEBAR_NODE_KIND.Diary,
        },
      },
    ],
    [t]
  );

  const handleSelectNode = useCallback(
    (node: OpsControlSidebarNode) => {
      if (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.WorkitemView) {
        setOpsControlProjectsView(OPS_CONTROL_PROJECTS_VIEW.WORK_ITEMS);
        openOpsControlTab({
          section: OPS_CONTROL_HOME_TAB.PROJECTS,
          title: t("navigation:routes.opsControl"),
        });
        return;
      }

      if (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.ProjectView) {
        setOpsControlProjectsView(OPS_CONTROL_PROJECTS_VIEW.PROJECTS);
        openOpsControlTab({
          section: OPS_CONTROL_HOME_TAB.PROJECTS,
          title: t("navigation:routes.opsControl"),
        });
        return;
      }

      if (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.GitHubIssues) {
        openOpsControlTab({
          section: OPS_CONTROL_HOME_TAB.GITHUB_ISSUES,
          title: t("navigation:routes.opsControl"),
        });
        return;
      }

      if (node.kind === OPS_CONTROL_SIDEBAR_NODE_KIND.GitHubPrs) {
        openOpsControlTab({
          section: OPS_CONTROL_HOME_TAB.GITHUB_PRS,
          title: t("navigation:routes.opsControl"),
        });
        return;
      }

      openOpsControlTab({
        section: OPS_CONTROL_HOME_TAB.OPS_CONTROL,
        title: t("navigation:routes.opsControl"),
      });
      const viewMode = VIEW_MODE_BY_NODE_KIND[node.kind];
      if (viewMode) setViewMode(viewMode);
    },
    [openOpsControlTab, setOpsControlProjectsView, setViewMode, t]
  );

  const emptyMessage = t("common:states.empty");
  const tabs = useMemo<PrimarySidebarTab[]>(
    () => [
      {
        key: "ops-control",
        label: t("sessions:opsControl.view.opsControl"),
        sections: [
          {
            key: "manage-items",
            title: t("sessions:opsControl.sidebar.manageItems"),
            content: (
              <OpsControlSidebarRows
                nodes={manageItemNodes}
                activeHomeTab={activeHomeTab}
                activeProjectsView={activeProjectsView}
                activeViewMode={activeViewMode}
                onSelectNode={handleSelectNode}
                emptyMessage={emptyMessage}
              />
            ),
            defaultFlexGrow: 0.35,
            resizable: false,
          },
          {
            key: "views",
            title: t("sessions:opsControl.sidebar.views"),
            content: (
              <OpsControlSidebarRows
                nodes={viewNodes}
                activeHomeTab={activeHomeTab}
                activeProjectsView={activeProjectsView}
                activeViewMode={activeViewMode}
                onSelectNode={handleSelectNode}
                emptyMessage={emptyMessage}
              />
            ),
            defaultFlexGrow: 1,
            resizable: false,
          },
        ],
      },
    ],
    [
      activeHomeTab,
      activeProjectsView,
      activeViewMode,
      emptyMessage,
      handleSelectNode,
      manageItemNodes,
      t,
      viewNodes,
    ]
  );

  const handleTabChange = useCallback(() => {}, []);

  return (
    <PrimarySidebarLayout
      tabs={tabs}
      activeTab="ops-control"
      onTabChange={handleTabChange}
      tabIconOnly={true}
      hideTabs={true}
    />
  );
});

OpsControlSidebar.displayName = "OpsControlSidebar";

export default OpsControlSidebar;
