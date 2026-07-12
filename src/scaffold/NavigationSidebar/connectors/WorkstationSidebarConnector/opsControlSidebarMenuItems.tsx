import { Boxes, CircleDot, GitPullRequest } from "lucide-react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import {
  OPS_CONTROL_HOME_TAB,
  OPS_CONTROL_PROJECTS_VIEW,
  type OpsControlHomeTab,
  type OpsControlProjectsView,
} from "@src/store/workstation";

import {
  OPS_CONTROL_GITHUB_ISSUES_MENU_ITEM_ID,
  OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID,
  OPS_CONTROL_KANBAN_MENU_ITEM_ID,
  OPS_CONTROL_MENU_ITEM_ID,
  OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
} from "../sidebarConnectorUtils";

export function resolveOpsControlSidebarMenuItemId({
  homeTab,
  projectsView,
}: {
  homeTab: OpsControlHomeTab;
  projectsView: OpsControlProjectsView;
}): string {
  if (homeTab === OPS_CONTROL_HOME_TAB.PROJECTS) {
    return projectsView === OPS_CONTROL_PROJECTS_VIEW.PROJECTS
      ? OPS_CONTROL_PROJECTS_MENU_ITEM_ID
      : OPS_CONTROL_MENU_ITEM_ID;
  }
  if (homeTab === OPS_CONTROL_HOME_TAB.GITHUB_ISSUES) {
    return OPS_CONTROL_GITHUB_ISSUES_MENU_ITEM_ID;
  }
  if (homeTab === OPS_CONTROL_HOME_TAB.GITHUB_PRS) {
    return OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID;
  }
  return OPS_CONTROL_KANBAN_MENU_ITEM_ID;
}

export function buildOpsControlSidebarMenuItems(labels: {
  projects: string;
  githubIssues: string;
  githubPrs: string;
}): NavigationMenuItem[] {
  return [
    {
      id: OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
      key: OPS_CONTROL_PROJECTS_MENU_ITEM_ID,
      label: labels.projects,
      icon: Boxes,
      iconName: "boxes",
    },
    {
      id: OPS_CONTROL_GITHUB_ISSUES_MENU_ITEM_ID,
      key: OPS_CONTROL_GITHUB_ISSUES_MENU_ITEM_ID,
      label: labels.githubIssues,
      icon: CircleDot,
      iconName: "circle-dot",
    },
    {
      id: OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID,
      key: OPS_CONTROL_GITHUB_PRS_MENU_ITEM_ID,
      label: labels.githubPrs,
      icon: GitPullRequest,
      iconName: "git-pull-request",
    },
  ];
}
