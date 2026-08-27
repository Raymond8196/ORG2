/**
 * ActivitySimulator Configuration
 *
 * Configuration for the activity simulator grid layout and icons
 */
import Activity from "@hugeicons/core-free-icons/Activity01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Rewind from "@hugeicons/core-free-icons/Backward01Icon";
import SkipBack from "@hugeicons/core-free-icons/Backward01Icon";
import Bug from "@hugeicons/core-free-icons/Bug01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import Monitor from "@hugeicons/core-free-icons/ComputerIcon";
import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Database from "@hugeicons/core-free-icons/DatabaseIcon";
import File from "@hugeicons/core-free-icons/File01Icon";
import FilePlus from "@hugeicons/core-free-icons/FileAddIcon";
import FileEdit from "@hugeicons/core-free-icons/FileEditIcon";
import Zap from "@hugeicons/core-free-icons/FlashIcon";
import Save from "@hugeicons/core-free-icons/FloppyDiskIcon";
import FolderSearch from "@hugeicons/core-free-icons/FolderSearchIcon";
import SkipForward from "@hugeicons/core-free-icons/Forward01Icon";
import Globe from "@hugeicons/core-free-icons/GlobeIcon";
import LayoutGrid from "@hugeicons/core-free-icons/LayoutGridIcon";
import Link from "@hugeicons/core-free-icons/Link01Icon";
import LayoutList from "@hugeicons/core-free-icons/ListViewIcon";
import MapPin from "@hugeicons/core-free-icons/Location01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import MessageSquare from "@hugeicons/core-free-icons/Message01Icon";
import Pause from "@hugeicons/core-free-icons/PauseIcon";
import PlayCircle from "@hugeicons/core-free-icons/PlayCircleIcon";
import Play from "@hugeicons/core-free-icons/PlayIcon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Server from "@hugeicons/core-free-icons/ServerStack01Icon";
import Settings from "@hugeicons/core-free-icons/Settings01Icon";
import Phone from "@hugeicons/core-free-icons/SmartPhone01Icon";
import Square from "@hugeicons/core-free-icons/SquareIcon";
import SquareStack from "@hugeicons/core-free-icons/SquareStackIcon";
import StopCircle from "@hugeicons/core-free-icons/StopCircleIcon";
import Eye from "@hugeicons/core-free-icons/ViewIcon";
import Wrench from "@hugeicons/core-free-icons/Wrench01Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

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
  grid1x1: LayoutList,
  grid1x2: LayoutList,
  grid2x1: LayoutList,
  grid2x2: LayoutGrid,
  grid2x3: LayoutGrid,
  // General icons
  settings: Settings,
  computer: Monitor,
  activity: Activity,
  // Event switching icons
  event: Zap,
  selector: Search,
  cycle: ArrowRight,
  search: Search,
  dropdown: ChevronDown,
  // Overview icons
  overview: LayoutGrid,
  // Browser navigation icons
  browser: Monitor,
  lock: Lock,
  back: ArrowLeft,
  forward: ArrowRight,
  // Replay control icons
  play: Play,
  pause: Pause,
  skipBack: SkipBack,
  skipForward: SkipForward,
  rewind: Rewind,
  fastForward: SkipForward,
  time: Clock,
  // Data source icons
  live: Square,
  mock: Database,
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
  run_command_line: Terminal,
  codebase_search: Search,
  read_file: File,
  search_codebase: Code,
  ask_user_pending: Phone,
  ask_user: MessageSquare,
  create_file: FilePlus,
  search_directory: FolderSearch,
  search_in_file: Search,
  file_diff: SquareStack,
  view_file: Eye,
  load_web_page: Globe,
  save_file: Save,
  call_tool: Wrench,
  start_dev_server: PlayCircle,
  stop_dev_server: StopCircle,
  edit_file_by_replace: FileEdit,
  append_file: FilePlus,
  file_range_edit: FileEdit,
  insert_content_at_line: FilePlus,
  goto_line: MapPin,
  find_symbol_references: Link,
  get_problems: Bug,
  // System states
  booting_system: Server,
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
