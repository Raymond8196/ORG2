/**
 * ActivitySimulator Configuration
 *
 * Configuration for the activity simulator grid layout and icons
 */
import Activity01Icon from "@hugeicons/core-free-icons/Activity01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import Bug01Icon from "@hugeicons/core-free-icons/Bug01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import DashboardSquare01Icon from "@hugeicons/core-free-icons/DashboardSquare01Icon";
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FilePlusIcon from "@hugeicons/core-free-icons/FilePlusIcon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import FloppyDiskIcon from "@hugeicons/core-free-icons/FloppyDiskIcon";
import FolderSearchIcon from "@hugeicons/core-free-icons/FolderSearchIcon";
import Forward01Icon from "@hugeicons/core-free-icons/Forward01Icon";
import InternetIcon from "@hugeicons/core-free-icons/InternetIcon";
import LayoutListIcon from "@hugeicons/core-free-icons/LayoutListIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import Location01Icon from "@hugeicons/core-free-icons/Location01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import MonitorIcon from "@hugeicons/core-free-icons/MonitorIcon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import PlayCircleIcon from "@hugeicons/core-free-icons/PlayCircleIcon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import RewindIcon from "@hugeicons/core-free-icons/RewindIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SkipBackIcon from "@hugeicons/core-free-icons/SkipBackIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
import SquareStackIcon from "@hugeicons/core-free-icons/SquareStackIcon";
import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon";
import type { IconSvgElement } from "@hugeicons/react";

import { SimulatorGridLayout } from "@src/store/ui/simulatorAtom";

// Layout configuration
export interface LayoutConfig {
  rows: number;
  cols: number;
  label: string;
}

// Re-export the type
export type GridLayout = SimulatorGridLayout;

// Icon configuration - using Lucide icons
export const ICON_CONFIG: Record<string, IconSvgElement> = {
  // Grid layout icons
  grid1x1: LayoutListIcon,
  grid1x2: LayoutListIcon,
  grid2x1: LayoutListIcon,
  grid2x2: DashboardSquare01Icon,
  grid2x3: DashboardSquare01Icon,
  // General icons
  settings: Settings01Icon,
  computer: MonitorIcon,
  activity: Activity01Icon,
  // Event switching icons
  event: FlashIcon,
  selector: Search01Icon,
  cycle: ArrowRight02Icon,
  search: Search01Icon,
  dropdown: ArrowDown01Icon,
  // Overview icons
  overview: DashboardSquare01Icon,
  // Browser navigation icons
  browser: MonitorIcon,
  lock: LockIcon,
  back: ArrowLeft02Icon,
  forward: ArrowRight02Icon,
  // Replay control icons
  play: PlayIcon,
  pause: PauseIcon,
  skipBack: SkipBackIcon,
  skipForward: Forward01Icon,
  rewind: RewindIcon,
  fastForward: Forward01Icon,
  time: Clock01Icon,
  // Data source icons
  live: SquareIcon,
  mock: DatabaseIcon,
};

// Layout options configuration
export const LAYOUT_OPTIONS: Record<SimulatorGridLayout, LayoutConfig> = {
  "1x1": { rows: 1, cols: 1, label: "Single" },
  "1x2": { rows: 1, cols: 2, label: "Side by Side" },
  "2x1": { rows: 2, cols: 1, label: "Stacked" },
  "2x2": { rows: 2, cols: 2, label: "Quad" },
  "2x3": { rows: 3, cols: 2, label: "Six Pack" },
  "3x3": { rows: 3, cols: 3, label: "Nine Grid" },
  "4x2": { rows: 2, cols: 4, label: "Eight Wide" },
  "3x4": { rows: 4, cols: 3, label: "Twelve Grid" },
};

/**
 * Calculate optimal grid layout based on task count
 * Tries to create a balanced grid that fits all tasks
 */
export function calculateAutoLayout(taskCount: number): SimulatorGridLayout {
  if (taskCount <= 1) return "1x1";
  if (taskCount === 2) return "1x2";
  if (taskCount === 3) return "2x2"; // 3 tasks in 2x2, one empty
  if (taskCount === 4) return "2x2";
  if (taskCount <= 6) return "2x3";
  if (taskCount <= 8) return "4x2";
  if (taskCount <= 9) return "3x3";
  return "3x4"; // Up to 12 tasks
}

// Default configuration
export const DEFAULT_LAYOUT: SimulatorGridLayout = "1x1";
export const DEFAULT_SHOW_DOCK = true;

// Note: Replay configuration is centralized in:
// Shared config with @src/config/workspace/replayConfig.ts

/**
 * Agent focus dot tokens — the pulsing blue dot that shows
 * where the agent is currently working.
 *
 * Two sizes:
 * - standard (6px): sidebar items, unpinned dock apps
 * - small (4px): pinned dock apps
 */
export const AGENT_DOT_TOKENS = {
  container: "flex h-4 w-4 flex-shrink-0 items-center justify-center",
  dot: "h-[6px] w-[6px] animate-pulse rounded-full bg-primary-6",
  containerSmall: "flex h-[4px] w-[4px] items-center justify-center",
  dotSmall: "h-[4px] w-[4px] animate-pulse rounded-full bg-primary-6",
} as const;

// Style configuration
export const STYLE_CONFIG = {
  headerHeight: "32px",
  gridGap: "12px",
  computerRadius: "12px",
  browserHeaderHeight: "40px",
};

// Event type to icon mapping - using Lucide icons
export const EVENT_TYPE_ICONS: Record<string, IconSvgElement> = {
  run_command_line: ComputerTerminal01Icon,
  codebase_search: Search01Icon,
  read_file: File01Icon,
  search_codebase: CodeIcon,
  ask_user_pending: SmartPhone01Icon,
  ask_user: Message01Icon,
  create_file: FilePlusIcon,
  search_directory: FolderSearchIcon,
  search_in_file: Search01Icon,
  file_diff: SquareStackIcon,
  view_file: ViewIcon,
  load_web_page: InternetIcon,
  save_file: FloppyDiskIcon,
  call_tool: Wrench01Icon,
  start_dev_server: PlayCircleIcon,
  stop_dev_server: StopCircleIcon,
  edit_file_by_replace: Edit04Icon,
  append_file: FilePlusIcon,
  file_range_edit: Edit04Icon,
  insert_content_at_line: FilePlusIcon,
  goto_line: Location01Icon,
  find_symbol_references: Link01Icon,
  get_problems: Bug01Icon,
  // System states
  booting_system: ServerStack01Icon,
};

// Get total cells for a layout
export const getLayoutCells = (layout: SimulatorGridLayout): number => {
  const config = LAYOUT_OPTIONS[layout];
  return config.rows * config.cols;
};

// Get grid icon for layout
export const getLayoutIcon = (layout: SimulatorGridLayout): IconSvgElement => {
  const iconMap: Record<SimulatorGridLayout, IconSvgElement> = {
    "1x1": ICON_CONFIG.grid1x1,
    "1x2": ICON_CONFIG.grid1x2,
    "2x1": ICON_CONFIG.grid2x1,
    "2x2": ICON_CONFIG.grid2x2,
    "2x3": ICON_CONFIG.grid2x3,
    "3x3": ICON_CONFIG.grid2x2,
    "4x2": ICON_CONFIG.grid2x2,
    "3x4": ICON_CONFIG.grid2x2,
  };
  return iconMap[layout];
};

// Get icon for event type
export const getEventTypeIcon = (eventType: string): IconSvgElement => {
  return EVENT_TYPE_ICONS[eventType] || ICON_CONFIG.event;
};
