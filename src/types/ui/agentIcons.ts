/**
 * Agent Icon Mappings
 *
 * UI-specific icon mappings for agent types and tool kinds.
 * Separated from pure types to keep type files clean of UI dependencies.
 */
import Bot from "@hugeicons/core-free-icons/BotIcon";
import Cpu from "@hugeicons/core-free-icons/CpuIcon";
import MousePointer2 from "@hugeicons/core-free-icons/Cursor02Icon";
import Zap from "@hugeicons/core-free-icons/FlashIcon";
import Github from "@hugeicons/core-free-icons/GithubIcon";
import HelpCircle from "@hugeicons/core-free-icons/HelpCircleIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import type {
  StreamingAgentType,
  ToolKind,
} from "@src/api/realtime/websocket/types";
import { resolveAgentIcon } from "@src/config/agentIcons";

type LucideIcon = IconSvgElement;

// ============================================
// Icon Mapping for Tool Kinds
// ============================================

/** Map tool kinds to suggested icons (Lucide icon names) */
export const TOOL_KIND_ICONS: Record<ToolKind, string> = {
  read: "FileText",
  write: "FilePlus",
  edit: "Pencil",
  delete: "Trash2",
  execute: "Terminal",
  search: "Search",
  web_search: "Globe",
  web_fetch: "Download",
  mcp: "Plug",
  subagent: "Bot",
  other: "Wrench",
};

// ============================================
// Icon Mapping for Agent Types
// ============================================

/** Map agent types to Lucide icon components */
export const AGENT_TYPE_ICONS: Record<StreamingAgentType, LucideIcon> = {
  claude: Bot,
  amp: Zap,
  cursor: MousePointer2,
  codex: resolveAgentIcon("codex"),
  acp: Cpu,
  droid: Bot,
  copilot: Github,
  unknown: HelpCircle,
};
