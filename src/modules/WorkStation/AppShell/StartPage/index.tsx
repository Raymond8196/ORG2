/**
 * WorkStationStartPage
 *
 * Launcher shown when the WorkStation tab pool is empty (on app start, and
 * whenever the user closes the last tab). Lets the user pick what to open —
 * mirroring the unified `+` menu's actions (TabBarPlusMenu). No tab is
 * auto-opened; everything lazy-loads from here.
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
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import KeyBadge from "@src/components/KeyBadge";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { focusBrowserUrlBar } from "@src/modules/WorkStation/Browser/Panels/BrowserMainPane/components/WebUrlBar";
import { EDITOR_TAB_CANVAS_BG_CLASS } from "@src/modules/WorkStation/shared/tokens";
import { openEditorSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import {
  STORY_ORG_SCOPE,
  createProjectDashboardTab,
  createProjectWorkItemsIndexTab,
  openTab as openTabMutation,
  requestNewBrowserSessionAtom,
  workstationLayoutAtom,
} from "@src/store/workstation";
import type { WorkStationTab } from "@src/store/workstation/tabs";

interface StartActionTileProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
}

const StartActionTile = memo<StartActionTileProps>(
  ({ icon: Icon, label, shortcut, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-start gap-3 rounded-xl border border-border-1 bg-fill-1 p-4 text-left transition-colors ${SURFACE_TOKENS.hover} active:bg-fill-3`}
    >
      <Icon size={22} strokeWidth={1.5} className="text-text-3" />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-text-2">{label}</span>
        {shortcut ? <KeyBadge keys={shortcut} showSeparator={false} /> : null}
      </div>
    </button>
  )
);
StartActionTile.displayName = "StartActionTile";

export const WorkStationStartPage: React.FC = memo(() => {
  const { t } = useTranslation("navigation");
  const requestNewBrowserSession = useSetAtom(requestNewBrowserSessionAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);

  const openTabInMainPane = useCallback(
    (tab: WorkStationTab) => {
      setLayout((prev) => {
        if (!prev?.mainPane) return prev;
        return { ...prev, mainPane: openTabMutation(prev.mainPane, tab) };
      });
    },
    [setLayout]
  );

  const actions = useMemo<StartActionTileProps[]>(
    () => [
      {
        icon: FileSearch,
        label: t("workstation.plusMenu.searchFile"),
        shortcut: "⌘P",
        onClick: () => openEditorSpotlight(""),
      },
      {
        icon: FolderTree,
        label: t("workstation.startPage.explorer"),
        shortcut: getShortcutKeys("open_file_folder_tab"),
        onClick: () => void WorkStationViewService.openFileFolderTab(),
      },
      {
        icon: GitBranch,
        label: t("workstation.startPage.sourceControl"),
        shortcut: getShortcutKeys("open_source_control_tab"),
        onClick: () => void WorkStationViewService.openSourceControlTab(),
      },
      {
        icon: SquareTerminal,
        label: t("workstation.startPage.terminal"),
        shortcut: getShortcutKeys("open_terminal_tab"),
        onClick: () => void WorkStationViewService.openTerminalTab(),
      },
      {
        icon: Globe,
        label: t("workstation.plusMenu.newBrowserTab"),
        onClick: () => {
          requestNewBrowserSession({});
          focusBrowserUrlBar();
        },
      },
      {
        icon: ShieldOff,
        label: t("workstation.plusMenu.newPrivateBrowserTab"),
        onClick: () => {
          requestNewBrowserSession({ isPrivate: true });
          focusBrowserUrlBar();
        },
      },
      {
        icon: ListTodo,
        label: t("workstation.plusMenu.workItems"),
        onClick: () =>
          openTabInMainPane(
            createProjectWorkItemsIndexTab({ orgScope: STORY_ORG_SCOPE.ALL })
          ),
      },
      {
        icon: Box,
        label: t("workstation.plusMenu.projects"),
        onClick: () =>
          openTabInMainPane(
            createProjectDashboardTab({ orgScope: STORY_ORG_SCOPE.ALL })
          ),
      },
    ],
    [openTabInMainPane, requestNewBrowserSession, t]
  );

  return (
    <div
      className={`flex h-full w-full items-center justify-center overflow-auto p-8 ${EDITOR_TAB_CANVAS_BG_CLASS}`}
    >
      <div className="w-full max-w-[560px]">
        <h1 className="mb-1 text-[20px] font-semibold text-text-1">
          {t("workstation.startPage.title")}
        </h1>
        <p className="mb-6 text-[13px] leading-snug text-text-3">
          {t("workstation.startPage.subtitle")}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {actions.map((action) => (
            <StartActionTile key={action.label} {...action} />
          ))}
        </div>
      </div>
    </div>
  );
});

WorkStationStartPage.displayName = "WorkStationStartPage";

export default WorkStationStartPage;
