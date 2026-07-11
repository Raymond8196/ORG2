import type { TFunction } from "i18next";
import { Folders, ListTodo, MessageCircle } from "lucide-react";
import React, { useMemo } from "react";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";

import type { WorkstationSidebarKey } from "./types";

export function isWorkstationSidebarKey(
  key: string
): key is WorkstationSidebarKey {
  return key === "folders" || key === "workstation" || key === "projects";
}

export function useWorkstationSidebarTabs(t: TFunction<"navigation">) {
  return useMemo(
    () => [
      {
        key: "folders",
        label: t("labels.folders"),
        icon: Folders,
        iconName: "folders",
      },
      {
        key: "workstation",
        label: t("labels.session"),
        icon: MessageCircle,
        iconName: "message-circle",
      },
      {
        key: "projects",
        label: t("labels.workItems"),
        icon: ListTodo,
        iconName: "list-todo",
      },
    ],
    [t]
  );
}

export function SidebarSearchShortcutTooltip({
  searchLabel,
}: {
  searchLabel: string;
}): React.ReactElement {
  return (
    <KeyboardShortcutTooltipContent
      rows={[
        { label: "Spotlight", shortcut: getShortcutKeys("spotlight_open") },
        {
          label: `${searchLabel} session`,
          shortcut: getShortcutKeys("agent_session_search"),
        },
      ]}
    />
  );
}
