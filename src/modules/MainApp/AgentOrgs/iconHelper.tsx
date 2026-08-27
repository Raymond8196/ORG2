/**
 * Icon Helper for Shortcut Actions
 *
 * Maps icon names (lucide-era component names) to hugeicons glyph data.
 */
import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import { createLogger } from "@src/hooks/logger";
import {
  AppWindowIcon as AppWindow,
  ArrowLeftRightIcon as ArrowLeftRight,
  ArrowRight02Icon as ArrowRight,
  CheckmarkCircle01Icon as CheckCircle,
  Clock01Icon as Clock,
  ViewIcon as Eye,
  Edit04Icon as FileEdit,
  File02Icon as FileText,
  FolderClosedIcon as Folder,
  WorkflowCircle05Icon as GitBranch,
  GitMergeIcon as GitMerge,
  type IconSvgElement,
  InboxIcon as Inbox,
  ListTodoIcon as ListTodo,
  RoadLocation01Icon as Milestone,
  PlayIcon as Play,
  PlayCircleIcon as PlayCircle,
  RepeatIcon as Repeat,
  RocketIcon as Rocket,
  Settings02Icon as Settings2,
  SplitIcon as Split,
  ComputerTerminal01Icon as Terminal,
  Timer01Icon as Timer,
  TypeIcon as Type,
} from "@src/icons";

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
