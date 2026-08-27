/**
 * Dock Configuration
 *
 * Centralized configuration for the simulator dock apps.
 */
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon";
import InternetIcon from "@hugeicons/core-free-icons/InternetIcon";
import Layout01Icon from "@hugeicons/core-free-icons/Layout01Icon";
import ListTodoIcon from "@hugeicons/core-free-icons/ListTodoIcon";
import WorkflowCircle05Icon from "@hugeicons/core-free-icons/WorkflowCircle05Icon";
import type { IconSvgElement } from "@hugeicons/react";

export interface DockApp {
  id: string;
  name: string;
  icon: IconSvgElement;
}

/** Agent Desk dock — agent activity apps only.
 *
 * Diff sits in its own leading segment so a `DockSegmentDivider` separates
 * it from the rest of the apps (mirrors the trailing divider before the
 * Background Tasks "infinity" pill). */
export const DOCK_APP_SEGMENTS: DockApp[][] = [
  [{ id: "DIFF", name: "Diff", icon: WorkflowCircle05Icon }],
  [
    { id: "CHANNELS", name: "Communication", icon: BubbleChatIcon },
    { id: "CODE_EDITOR", name: "Code Editor", icon: CodeIcon },
    { id: "BROWSER", name: "Browser", icon: InternetIcon },
    { id: "STORY_MANAGER", name: "Project Manager", icon: ListTodoIcon },
    { id: "CANVAS", name: "Canvas", icon: Layout01Icon },
  ],
];

export const DOCK_APPS: DockApp[] = DOCK_APP_SEGMENTS.flat();

export const BACKGROUND_TASKS_DOCK_APP: DockApp = {
  id: "BACKGROUND_TASKS",
  name: "Background Tasks",
  icon: Infinity01Icon,
};

export function getAppById(id: string): DockApp | undefined {
  return DOCK_APPS.find((app) => app.id === id);
}
