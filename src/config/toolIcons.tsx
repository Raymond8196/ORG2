/**
 * Icon rendering for agent tools and events.
 *
 * **Authoritative icon ids** for built-in tools come from Rust `ToolInfo.icon_id`
 * (`list_all_tools`). `LUCIDE_ICON_BY_ID` maps those kebab-case ids (lucide.dev slugs)
 * to components. Non-Lucide brand icons (e.g., MCP logo) are registered in
 * `CUSTOM_ICON_BY_ID` with a namespaced id (e.g., "mcp-logo"). Both maps are
 * checked during resolution so Rust can reference either kind.
 *
 * NOTE: Terminal tool detection uses normalizeFunctionName() (Rust source of truth
 * via cli_agents/alias_map.rs) instead of hardcoded tool names.
 */
import Activity from "@hugeicons/core-free-icons/Activity01Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import Network from "@hugeicons/core-free-icons/AiNetworkIcon";
import ArrowBigRightDash from "@hugeicons/core-free-icons/ArrowBigRightDashIcon";
import ArrowRightLeft from "@hugeicons/core-free-icons/ArrowLeftRightIcon";
import BookSearch from "@hugeicons/core-free-icons/Book01Icon";
import Bot from "@hugeicons/core-free-icons/BotIcon";
import BotOff from "@hugeicons/core-free-icons/BotOffIcon";
import Brain from "@hugeicons/core-free-icons/BrainIcon";
import Briefcase from "@hugeicons/core-free-icons/Briefcase01Icon";
import MessageCircle from "@hugeicons/core-free-icons/BubbleChatIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import XCircle from "@hugeicons/core-free-icons/CancelCircleIcon";
import Focus from "@hugeicons/core-free-icons/CenterFocusIcon";
import BotMessageSquare from "@hugeicons/core-free-icons/ChatBotIcon";
import ClipboardList from "@hugeicons/core-free-icons/CheckListIcon";
import ListChecks from "@hugeicons/core-free-icons/CheckListIcon";
import ListTodo from "@hugeicons/core-free-icons/CheckListIcon";
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Chrome from "@hugeicons/core-free-icons/ChromeIcon";
import ClipboardPen from "@hugeicons/core-free-icons/ClipboardPenIcon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import Monitor from "@hugeicons/core-free-icons/ComputerIcon";
import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import ClipboardCopy from "@hugeicons/core-free-icons/Copy01Icon";
import MousePointer2 from "@hugeicons/core-free-icons/Cursor02Icon";
import MousePointerClick from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Database from "@hugeicons/core-free-icons/DatabaseIcon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import FileText from "@hugeicons/core-free-icons/File02Icon";
import FileBox from "@hugeicons/core-free-icons/FileBoxIcon";
import FileDiff from "@hugeicons/core-free-icons/FileDiffIcon";
import FilePenLine from "@hugeicons/core-free-icons/FilePenLineIcon";
import FileSearch from "@hugeicons/core-free-icons/FileSearchIcon";
import Braces from "@hugeicons/core-free-icons/FirstBracketIcon";
import FolderCog from "@hugeicons/core-free-icons/FolderCogIcon";
import FolderGit2 from "@hugeicons/core-free-icons/FolderGitTwoIcon";
import FolderOpen from "@hugeicons/core-free-icons/FolderOpenIcon";
import FolderSearch from "@hugeicons/core-free-icons/FolderSearchIcon";
import Fullscreen from "@hugeicons/core-free-icons/FullScreenIcon";
import GitBranch from "@hugeicons/core-free-icons/GitBranchIcon";
import Globe from "@hugeicons/core-free-icons/GlobeIcon";
import CircleHelp from "@hugeicons/core-free-icons/HelpCircleIcon";
import ListTree from "@hugeicons/core-free-icons/HierarchyFilesIcon";
import Image from "@hugeicons/core-free-icons/Image01Icon";
import Inbox from "@hugeicons/core-free-icons/InboxIcon";
import Infinity from "@hugeicons/core-free-icons/Infinity01Icon";
import Keyboard from "@hugeicons/core-free-icons/KeyboardIcon";
import Layers from "@hugeicons/core-free-icons/Layers01Icon";
import Layout from "@hugeicons/core-free-icons/Layout01Icon";
import LayoutList from "@hugeicons/core-free-icons/ListViewIcon";
import List from "@hugeicons/core-free-icons/ListViewIcon";
import Logs from "@hugeicons/core-free-icons/LogsIcon";
import Mail from "@hugeicons/core-free-icons/Mail01Icon";
import Send from "@hugeicons/core-free-icons/MailSend01Icon";
import Map from "@hugeicons/core-free-icons/MapsIcon";
import MessageCircleQuestionMark from "@hugeicons/core-free-icons/MessageCircleQuestionMarkIcon";
import MessagesSquare from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import MoveVertical from "@hugeicons/core-free-icons/MoveTopIcon";
import BellRing from "@hugeicons/core-free-icons/NotificationBubbleIcon";
import Box from "@hugeicons/core-free-icons/PackageIcon";
import Plug from "@hugeicons/core-free-icons/Plug01Icon";
import RefreshCw from "@hugeicons/core-free-icons/RefreshIcon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Cog from "@hugeicons/core-free-icons/Settings01Icon";
import Share2 from "@hugeicons/core-free-icons/Share02Icon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import ShieldOff from "@hugeicons/core-free-icons/Shield02Icon";
import Sparkle from "@hugeicons/core-free-icons/SparklesIcon";
import Timer from "@hugeicons/core-free-icons/Timer01Icon";
import User from "@hugeicons/core-free-icons/UserIcon";
import Users from "@hugeicons/core-free-icons/UserMultipleIcon";
import Eye from "@hugeicons/core-free-icons/ViewIcon";
import Wrench from "@hugeicons/core-free-icons/Wrench01Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import React from "react";

import { McpLogoIcon } from "@src/assets/channelIcons/McpLogoIcon";
import {
  getBuiltinToolActionIconId,
  getBuiltinToolIconId,
  getBuiltinToolStatusIconId,
  getCliUiCanonical,
} from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { normalizeFunctionName } from "@src/lib/activityData/activityNormalizers";

type LucideIcon = IconSvgElement;

/** Default size/class for chat ToolCallBlock and Integrations tool rows. */
export const DEFAULT_TOOL_ICON_SIZE = 14;
export const DEFAULT_TOOL_ICON_CLASS = "text-text-2";

/**
 * Maps Rust `icon_id` strings (kebab-case) to Lucide components.
 * Keep in sync with `builtin_tools_list.rs` `row(..., icon_id)`.
 */
export const LUCIDE_ICON_BY_ID: Record<string, LucideIcon> = {
  activity: Activity,
  "arrow-big-right-dash": ArrowBigRightDash,
  "arrow-right-left": ArrowRightLeft,
  "bell-ring": BellRing,
  "book-search": BookSearch,
  bot: Bot,
  "bot-message-square": BotMessageSquare,
  "bot-off": BotOff,
  box: Box,
  braces: Braces,
  brain: Brain,
  briefcase: Briefcase,
  "check-circle-2": CheckCircle2,
  chrome: Chrome,
  "circle-help": CircleHelp,
  "clipboard-copy": ClipboardCopy,
  "clipboard-list": ClipboardList,
  "clipboard-pen": ClipboardPen,
  clock: Clock,
  cog: Cog,
  database: Database,
  eye: Eye,
  "file-box": FileBox,
  "file-diff": FileDiff,
  "file-pen-line": FilePenLine,
  "file-text": FileText,
  focus: Focus,
  "folder-cog": FolderCog,
  "folder-git-2": FolderGit2,
  "folder-open": FolderOpen,
  "folder-search": FolderSearch,
  fullscreen: Fullscreen,
  "git-branch": GitBranch,
  globe: Globe,
  image: Image,
  inbox: Inbox,
  infinity: Infinity,
  keyboard: Keyboard,
  layers: Layers,
  layout: Layout,
  "layout-list": LayoutList,
  list: List,
  "list-checks": ListChecks,
  "list-todo": ListTodo,
  "list-tree": ListTree,
  mail: Mail,
  map: Map,
  "message-circle": MessageCircle,
  "message-circle-question-mark": MessageCircleQuestionMark,
  "messages-square": MessagesSquare,
  monitor: Monitor,
  "mouse-pointer-click": MousePointerClick,
  "move-vertical": MoveVertical,
  "mouse-pointer-2": MousePointer2,
  network: Network,
  plug: Plug,
  plus: Plus,
  "refresh-cw": RefreshCw,
  search: Search,
  send: Send,
  "share-2": Share2,
  shield: Shield,
  "shield-off": ShieldOff,
  sparkle: Sparkle,
  terminal: Terminal,
  timer: Timer,
  "trash-2": Trash2,
  user: User,
  users: Users,
  wrench: Wrench,
  x: X,
  "x-circle": XCircle,
};

/**
 * Non-Lucide brand icons that Rust can reference via `icon_id`.
 * Each component must accept `LucideProps` ({ size, className, ... }).
 */
const CUSTOM_ICON_BY_ID: Record<string, LucideIcon> = {
  "mcp-logo": McpLogoIcon as unknown as LucideIcon,
};

/** Unified lookup: Lucide icons + custom brand icons. */
const ICON_BY_ID: Record<string, LucideIcon> = {
  ...LUCIDE_ICON_BY_ID,
  ...CUSTOM_ICON_BY_ID,
};

/**
 * Aliases and legacy names only — not Rust canonical built-ins (those use
 * `getBuiltinToolIconId` + `LUCIDE_ICON_BY_ID`). Chat streams often emit
 * adapter names; keep mappings here for icons without a Lucide id path.
 *
 * Action-specific icons are now defined in Rust `ToolInfo.action_icons` and
 * accessed via `getBuiltinToolActionIconId(toolName, action)`.
 */
export const TOOL_ICON_COMPONENTS: Record<string, LucideIcon> = {
  // Search aliases
  search_in_file: Search,
  search: Search,
  search_files: Search,
  search_code_files: Search,
  code_search: Search,
  glob_file_search: FileSearch,

  /**
   * Ask-user / clarification tools — Rust `ui_metadata_details` uses
   * `message-circle-question-mark` for `ask_user_questions`. The CLI-agent
   * aliases (`ask_question`, `ask_followup_question`) inherit the same
   * icon to stay consistent. Listed here so we don't fall through to
   * Wrench when `init_tool_registry` is empty or not yet loaded.
   */
  ask_user: MessageCircleQuestionMark,
  ask_question: MessageCircleQuestionMark,
  ask_followup_question: MessageCircleQuestionMark,

  // Misc aliases
  git: GitBranch,
  manage_story_list: Briefcase,
  terminal: Terminal,

  // Claude Code background task management tools
  TaskCreate: Timer,
  task_create: Timer,
  TaskStop: Timer,
  task_stop: Timer,
  TaskOutput: Timer,
  task_output: Timer,
  TaskGet: Timer,
  task_get: Timer,
  TaskList: Timer,
  task_list: Timer,
  TaskUpdate: Timer,
  task_update: Timer,

  // Claude Code shell / execution tools
  PowerShell: Terminal,
  powershell: Terminal,
  power_shell: Terminal,
  Monitor: Terminal,
  monitor: Terminal,

  // Claude Code notebook editing
  NotebookEdit: FilePenLine,
  notebook_edit: FilePenLine,

  // Claude Code plan mode
  EnterPlanMode: ClipboardList,
  enter_plan_mode: ClipboardList,
  ExitPlanMode: ClipboardList,
  exit_plan_mode: ClipboardList,

  // Claude Code git worktree
  EnterWorktree: GitBranch,
  enter_worktree: GitBranch,
  ExitWorktree: GitBranch,
  exit_worktree: GitBranch,

  // Claude Code skill invocation
  Skill: Sparkle,
  skill: Sparkle,

  // Claude Code scheduled/cron tasks
  CronCreate: Clock,
  cron_create: Clock,
  CronDelete: Clock,
  cron_delete: Clock,
  CronList: Clock,
  cron_list: Clock,

  // Claude Code agent team collaboration
  TeamCreate: MessagesSquare,
  team_create: MessagesSquare,
  TeamDelete: MessagesSquare,
  team_delete: MessagesSquare,
  SendMessage: MessagesSquare,
  send_message: MessagesSquare,

  // MCP meta-tools
  ListMcpResourcesTool: Plug,
  list_mcp_resources: Plug,
  ReadMcpResourceTool: Plug,
  read_mcp_resource: Plug,
  ToolSearch: Plug,
  tool_search: Plug,

  // Notification / remote tools
  PushNotification: BellRing,
  push_notification: BellRing,
  RemoteTrigger: Share2,
  remote_trigger: Share2,
  ShareOnboardingGuide: Share2,
  share_onboarding_guide: Share2,
};

/**
 * Check if a tool is a terminal/shell tool.
 * Uses normalizeFunctionName (Rust source of truth) to resolve CLI aliases.
 */
/**
 * Check if a tool is a terminal/shell command tool.
 * All shell tools (run_shell, bash, Shell, execute, etc.) normalize to "run_shell".
 */
export function isTerminalTool(toolName: string): boolean {
  return normalizeFunctionName(toolName) === "run_shell";
}

/**
 * Get the Lucide icon component for a tool.
 *
 * @param toolName - Tool name (e.g., "control_browser", "read_file")
 * @param iconId - Optional explicit icon id (takes precedence)
 * @param action - Optional action name for action-specific icons (e.g., "navigate", "act")
 */
export function getToolIconComponent(
  toolName: string,
  iconId?: string | null,
  action?: string | null
): LucideIcon {
  const uiCanonical = getCliUiCanonical(toolName);

  // 1. Explicit icon id takes precedence
  if (iconId) {
    const byId = ICON_BY_ID[iconId];
    if (byId) return byId;
  }

  // 2. Action-specific icon from Rust (e.g. control_browser + "navigate" → globe)
  if (action) {
    const actionIconId =
      getBuiltinToolActionIconId(toolName, action) ??
      getBuiltinToolActionIconId(uiCanonical, action);
    if (actionIconId) {
      const fromAction = ICON_BY_ID[actionIconId];
      if (fromAction) return fromAction;
    }
  }

  // 3. Tool's default icon from Rust
  const builtinKebab =
    getBuiltinToolIconId(toolName) ?? getBuiltinToolIconId(uiCanonical);
  if (builtinKebab) {
    const fromBuiltin = ICON_BY_ID[builtinKebab];
    if (fromBuiltin) return fromBuiltin;
  }

  // 4. Frontend alias fallbacks
  const direct =
    TOOL_ICON_COMPONENTS[toolName] ?? TOOL_ICON_COMPONENTS[uiCanonical];
  if (direct) return direct;

  // 5. Prefix-based fallbacks (includes ui_canonical aliases from Rust)
  if (
    toolName === "internal_browser" ||
    toolName === "control_internal_browser" ||
    uiCanonical === "internal_browser" ||
    uiCanonical === "control_internal_browser"
  ) {
    return MousePointerClick;
  }
  if (
    toolName === "browser" ||
    toolName === "control_browser_with_agent_browser" ||
    toolName === "control_browser_with_playwright" ||
    toolName === "control_external_browser" ||
    toolName.startsWith("browser") ||
    uiCanonical === "browser" ||
    uiCanonical === "control_browser_with_agent_browser" ||
    uiCanonical === "control_browser_with_playwright" ||
    uiCanonical === "control_external_browser" ||
    uiCanonical.startsWith("browser")
  ) {
    return Chrome;
  }
  if (toolName.startsWith("db_") || uiCanonical.startsWith("db_")) {
    return Database;
  }
  if (isTerminalTool(toolName) || isTerminalTool(uiCanonical)) return Terminal;

  return Wrench;
}

export interface GetToolIconOptions {
  size?: number;
  className?: string;
  /** When set (e.g. from `list_all_tools`), takes precedence over name-based lookup. */
  iconId?: string | null;
  /** Action name for action-specific icons (e.g., "navigate", "act" for control_browser). */
  action?: string | null;
}

/**
 * Renders the Lucide icon for a tool (chat, Integrations, subagents).
 * Supports action-specific icons via the `action` option.
 */
export function getToolIcon(
  toolName: string,
  options?: GetToolIconOptions
): React.ReactNode {
  const Icon = getToolIconComponent(toolName, options?.iconId, options?.action);
  const size = options?.size ?? DEFAULT_TOOL_ICON_SIZE;
  const className = options?.className ?? DEFAULT_TOOL_ICON_CLASS;
  return <Icon size={size} className={className} />;
}

// ============================================
// Event Icons (status-dependent)
// ============================================

/**
 * Get the Lucide icon component for an event, optionally resolved by status.
 *
 * Priority:
 * 1. Status-specific icon from Rust (e.g., approval_request + "approved" → check-circle-2)
 * 2. Action-specific icon from Rust (e.g., await_output + "monitor" → focus)
 * 3. Event's default icon from Rust (e.g., approval_request → clock)
 * 4. Falls through to getToolIconComponent() for legacy/alias resolution
 */
export function getEventIconComponent(
  eventType: string,
  status?: string | null,
  action?: string | null
): LucideIcon {
  const uiCanonical = getCliUiCanonical(eventType);

  if (status) {
    const statusIconId =
      getBuiltinToolStatusIconId(eventType, status) ??
      getBuiltinToolStatusIconId(uiCanonical, status);
    if (statusIconId) {
      const icon = ICON_BY_ID[statusIconId];
      if (icon) return icon;
    }
    // Registry not loaded or missing status row — match Rust `row_with_status` defaults
    if (eventType === "ask_user_questions" && status === "answered") {
      return CheckCircle2;
    }
  }

  const toolIcon = getToolIconComponent(eventType, undefined, action);
  return toolIcon === Wrench ? Logs : toolIcon;
}

export interface GetEventIconOptions {
  size?: number;
  className?: string;
  /** Event result status (e.g., "approved", "denied", "switched", "answered"). */
  status?: string | null;
  /** Action / sub-command name for action-specific icons (e.g., await_output "monitor"). */
  action?: string | null;
}

/**
 * Renders the Lucide icon for a chat event with optional status-dependent resolution.
 * All event components should use this instead of directly importing from lucide-react.
 */
export function getEventIcon(
  eventType: string,
  options?: GetEventIconOptions
): React.ReactNode {
  const Icon = getEventIconComponent(
    eventType,
    options?.status,
    options?.action
  );
  const size = options?.size ?? DEFAULT_TOOL_ICON_SIZE;
  const className = options?.className ?? DEFAULT_TOOL_ICON_CLASS;
  return <Icon size={size} className={className} />;
}
