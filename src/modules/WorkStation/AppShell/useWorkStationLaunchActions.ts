/**
 * useWorkStationLaunchActions
 *
 * Single source of truth for the WorkStation "launch" actions shared by the
 * empty-pool Launchpad (`WorkStationStartPage`) and the tab-bar `+` dropdown
 * (`TabBarPlusMenu`). Keeping both surfaces on the same ordered list is what
 * guarantees their items and icons stay in sync.
 *
 * Each action opens (or activates) a real `mainPane` tab, except the Browser
 * entries — the Browser host keeps its sessions in a separate store, so those
 * reveal the Browser surface (`dockFilter = "browser"`) and request a session
 * instead of adding a `mainPane` tab.
 */
import { useSetAtom } from "jotai";
import {
  Box,
  FileSearch,
  FolderTree,
  GitBranch,
  Globe,
  ListTodo,
  type LucideIcon,
  ShieldOff,
  SquareTerminal,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { focusBrowserUrlBar } from "@src/modules/WorkStation/Browser/Panels/BrowserMainPane/components/WebUrlBar";
import { openEditorSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import {
  CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
  STORY_ORG_SCOPE,
  createExplorerTab,
  createProjectDashboardTab,
  createProjectWorkItemsIndexTab,
  createSourceControlTab,
  createTerminalTab,
  dockFilterAtom,
  openTab as openTabMutation,
  requestNewBrowserSessionAtom,
  workstationLayoutAtom,
} from "@src/store/workstation";
import type { WorkStationTab } from "@src/store/workstation/tabs";

export type WorkStationLaunchActionId =
  | "searchFile"
  | "explorer"
  | "sourceControl"
  | "terminal"
  | "newBrowserTab"
  | "newPrivateBrowserTab"
  | "workItems"
  | "projects";

export interface WorkStationLaunchAction {
  id: WorkStationLaunchActionId;
  icon: LucideIcon;
  label: string;
  /** Display string for the keyboard hint, when the action has one. */
  shortcut?: string;
  onClick: () => void;
}

export function useWorkStationLaunchActions(): WorkStationLaunchAction[] {
  const { t } = useTranslation("navigation");
  const requestNewBrowserSession = useSetAtom(requestNewBrowserSessionAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const setDockFilter = useSetAtom(dockFilterAtom);

  const openTabInMainPane = useCallback(
    (tab: WorkStationTab) => {
      setLayout((prev) => {
        if (!prev?.mainPane) return prev;
        return { ...prev, mainPane: openTabMutation(prev.mainPane, tab) };
      });
    },
    [setLayout]
  );

  const openBrowser = useCallback(
    (isPrivate: boolean) => {
      setDockFilter("browser");
      requestNewBrowserSession(isPrivate ? { isPrivate: true } : {});
      focusBrowserUrlBar();
    },
    [setDockFilter, requestNewBrowserSession]
  );

  return useMemo<WorkStationLaunchAction[]>(
    () => [
      {
        id: "searchFile",
        icon: FileSearch,
        label: t("workstation.plusMenu.searchFile"),
        shortcut: "⌘P",
        onClick: () => openEditorSpotlight(""),
      },
      {
        id: "explorer",
        icon: FolderTree,
        label: t("workstation.startPage.explorer"),
        shortcut: getShortcutKeys("open_file_folder_tab"),
        onClick: () => openTabInMainPane(createExplorerTab()),
      },
      {
        id: "sourceControl",
        icon: GitBranch,
        label: t("workstation.startPage.sourceControl"),
        shortcut: getShortcutKeys("open_source_control_tab"),
        onClick: () =>
          openTabInMainPane(createSourceControlTab(0, { mode: "all-changes" })),
      },
      {
        id: "terminal",
        icon: SquareTerminal,
        label: t("workstation.startPage.terminal"),
        shortcut: getShortcutKeys("open_terminal_tab"),
        onClick: () =>
          openTabInMainPane(
            createTerminalTab(
              CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
              t("workstation.startPage.terminal")
            )
          ),
      },
      {
        id: "newBrowserTab",
        icon: Globe,
        label: t("workstation.plusMenu.newBrowserTab"),
        onClick: () => openBrowser(false),
      },
      {
        id: "newPrivateBrowserTab",
        icon: ShieldOff,
        label: t("workstation.plusMenu.newPrivateBrowserTab"),
        onClick: () => openBrowser(true),
      },
      {
        id: "workItems",
        icon: ListTodo,
        label: t("workstation.plusMenu.workItems"),
        onClick: () =>
          openTabInMainPane(
            createProjectWorkItemsIndexTab({ orgScope: STORY_ORG_SCOPE.ALL })
          ),
      },
      {
        id: "projects",
        icon: Box,
        label: t("workstation.plusMenu.projects"),
        onClick: () =>
          openTabInMainPane(
            createProjectDashboardTab({ orgScope: STORY_ORG_SCOPE.ALL })
          ),
      },
    ],
    [t, openTabInMainPane, openBrowser]
  );
}
