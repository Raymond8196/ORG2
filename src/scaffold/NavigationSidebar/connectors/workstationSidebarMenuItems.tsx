import { Box, Columns3, Github, ListTodo, Plus, SquarePen } from "lucide-react";
import React from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { SessionCreatorDraft } from "@src/store/session";
import { resolveSessionRowIcon } from "@src/util/session/sessionSidebarRow";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import {
  NEW_SESSION_MENU_ITEM_ID,
  OPS_CONTROL_KANBAN_MENU_ITEM_ID,
  OPS_CONTROL_MENU_ITEM_ID,
  PROJECTS_IMPORT_GITHUB_ISSUES_MENU_ITEM_ID,
  PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
  PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
  getDraftMenuItemId,
  getDraftPreviewText,
} from "./sidebarConnectorUtils";

interface BuildPinnedMenuItemsParams {
  newSessionLabel: string;
  newSessionShortcut: string;
  opsControlLabel: string;
  opsControlItems: NavigationMenuItem[];
  kanbanLabel: string;
  kanbanShortcut: string;
}

interface BuildProjectsPinnedMenuItemsParams {
  createProjectLabel: string;
  createWorkItemLabel: string;
  importGithubIssuesLabel: string;
}

export function buildPinnedMenuItems({
  newSessionLabel,
  newSessionShortcut,
  opsControlLabel,
  opsControlItems,
  kanbanLabel,
  kanbanShortcut,
}: BuildPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: NEW_SESSION_MENU_ITEM_ID,
      key: NEW_SESSION_MENU_ITEM_ID,
      label: newSessionLabel,
      icon: Plus,
      iconName: "plus",
      shortcut: newSessionShortcut,
    },
    {
      id: OPS_CONTROL_KANBAN_MENU_ITEM_ID,
      key: OPS_CONTROL_KANBAN_MENU_ITEM_ID,
      label: kanbanLabel,
      icon: Columns3,
      iconName: "columns-3",
      shortcut: kanbanShortcut,
    },
    {
      id: OPS_CONTROL_MENU_ITEM_ID,
      key: OPS_CONTROL_MENU_ITEM_ID,
      label: opsControlLabel,
      icon: ListTodo,
      iconName: "list-todo",
      children: opsControlItems,
      dataTestId: "sidebar-open-ops-control",
    },
  ];
}

export function buildProjectsPinnedMenuItems({
  createProjectLabel,
  createWorkItemLabel,
  importGithubIssuesLabel,
}: BuildProjectsPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
      key: PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
      label: createWorkItemLabel,
      icon: SquarePen,
      iconName: "square-pen",
    },
    {
      id: PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
      key: PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
      label: createProjectLabel,
      icon: Box,
      iconName: "box",
    },
    {
      id: PROJECTS_IMPORT_GITHUB_ISSUES_MENU_ITEM_ID,
      key: PROJECTS_IMPORT_GITHUB_ISSUES_MENU_ITEM_ID,
      label: importGithubIssuesLabel,
      icon: Github,
      iconName: "github",
    },
  ];
}

interface BuildDraftMenuItemsParams {
  sessionCreatorDrafts: readonly SessionCreatorDraft[];
  draftsLabel: string;
}

export function buildDraftMenuItems({
  sessionCreatorDrafts,
  draftsLabel,
}: BuildDraftMenuItemsParams): NavigationMenuItem[] {
  if (sessionCreatorDrafts.length === 0) return [];
  return [
    {
      id: "separator-drafts",
      key: "separator-drafts",
      label: draftsLabel,
    },
    ...sessionCreatorDrafts.map((draft) => {
      const menuItemId = getDraftMenuItemId(draft.id);
      return {
        id: menuItemId,
        key: menuItemId,
        label: getDraftPreviewText(draft),
        icon: resolveSessionRowIcon({
          session_id: draft.id,
          agentIconId: draft.agentIconId ?? undefined,
          cliAgentType: draft.cliAgentType ?? undefined,
        }),
        shortcut: formatRelativeTime(draft.createdAt, "nano"),
        trailingElement: (
          <span className="h-1.5 w-1.5 rounded-full border border-border-3 bg-transparent" />
        ),
      } satisfies NavigationMenuItem;
    }),
  ];
}
