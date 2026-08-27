/**
 * Icon Helper for Shortcut Actions
 *
 * Maps icon names (Lucide icon component names) to actual Lucide icon components.
 */
import AppWindow from "@hugeicons/core-free-icons/AppWindowIcon";
import ArrowLeftRight from "@hugeicons/core-free-icons/ArrowLeftRightIcon";
import ArrowRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ListTodo from "@hugeicons/core-free-icons/CheckListIcon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import FileText from "@hugeicons/core-free-icons/File02Icon";
import FileEdit from "@hugeicons/core-free-icons/FileEditIcon";
import Folder from "@hugeicons/core-free-icons/Folder01Icon";
import GitBranch from "@hugeicons/core-free-icons/GitBranchIcon";
import GitMerge from "@hugeicons/core-free-icons/GitMergeIcon";
import Inbox from "@hugeicons/core-free-icons/InboxIcon";
import PlayCircle from "@hugeicons/core-free-icons/PlayCircleIcon";
import Play from "@hugeicons/core-free-icons/PlayIcon";
import Repeat from "@hugeicons/core-free-icons/RepeatIcon";
import Milestone from "@hugeicons/core-free-icons/RoadLocation01Icon";
import Rocket from "@hugeicons/core-free-icons/RocketIcon";
import Settings2 from "@hugeicons/core-free-icons/Settings02Icon";
import Split from "@hugeicons/core-free-icons/SplitIcon";
import Type from "@hugeicons/core-free-icons/TextIcon";
import Timer from "@hugeicons/core-free-icons/Timer01Icon";
import Eye from "@hugeicons/core-free-icons/ViewIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("iconHelper");

// Icon name to icon data mapping
const ICON_MAP: Record<string, IconSvgElement> = {
  // Core controls
  Terminal,
  Timer,
  Clock,
  GitBranch,
  Split,
  Repeat,

  // File operations
  FileEdit,
  FileText,
  Folder,

  // Session workflow stages
  Inbox, // intake
  ListTodo, // planning
  Play, // execution
  Eye, // review
  GitMerge, // merge
  Rocket, // start session
  Milestone, // when session reaches stage
  PlayCircle, // when session completes

  // Session workflow config
  Settings2,
  ArrowRight, // stage transition

  // When triggers
  AppWindow, // when app opens
  CheckCircle, // when work item status changes

  // Variable categories
  Type, // text variable
  ArrowLeftRight, // action input variable
} as const;

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Render an icon from an icon name string
 */
export function renderActionIcon(
  iconName: string,
  props?: IconProps
): React.ReactNode {
  const icon = ICON_MAP[iconName];
  if (!icon) {
    log.warn(`Unknown icon name: ${iconName}`);
    return null;
  }
  return (
    <AnyIcon
      icon={icon}
      size={props?.size || 14}
      strokeWidth={props?.strokeWidth ?? 2}
      className={props?.className}
    />
  );
}
