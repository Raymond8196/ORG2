/**
 * LeftPanel Configuration
 *
 * Centralized configuration for left panel components.
 * Includes icon definitions and constants.
 */
import FilePlus from "@hugeicons/core-free-icons/FileAddIcon";
import FilePlus2 from "@hugeicons/core-free-icons/FileAddIcon";
import Files from "@hugeicons/core-free-icons/Files01Icon";
import Filter from "@hugeicons/core-free-icons/FilterIcon";
import FolderPlus from "@hugeicons/core-free-icons/FolderAddIcon";
import GitBranch from "@hugeicons/core-free-icons/GitBranchIcon";
import ListTree from "@hugeicons/core-free-icons/HierarchyFilesIcon";
import Layers from "@hugeicons/core-free-icons/Layers01Icon";
import ListChevronsDownUp from "@hugeicons/core-free-icons/ListChevronsDownUpIcon";
import List from "@hugeicons/core-free-icons/ListViewIcon";
import Ellipsis from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import RefreshCw from "@hugeicons/core-free-icons/RefreshIcon";
import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
import { HugeiconsIcon } from "@hugeicons/react";

// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  // Tab icons
  files: Files,
  search: SearchIcon,
  sourceControl: GitBranch,

  // Action icons
  filter: Filter,
  addFile: FilePlus,
  addFolder: FolderPlus,
  refresh: RefreshCw,
  collapseAll: ListChevronsDownUp,
  list: List,
  listTree: ListTree,
  group: Layers,
  openInTab: FilePlus2,
  moreActions: Ellipsis,
} as const;

// ============================================
// Tab Configuration
// ============================================

export const TAB_ORDER = ["files", "search"] as const;

/** Tab label i18n keys - resolve with t() at render time */
export const TAB_LABELS: Record<string, string> = {
  files: "tabs.explorer",
  search: "tabs.search",
} as const;

// ============================================
// Constants
// ============================================

export const PANEL_CONSTANTS = {
  // Width
  DEFAULT_WIDTH: "w-[240px]",
  WIDTH_PX: 240,

  // Icon sizes
  TAB_ICON_SIZE: 16,
  ACTION_ICON_SIZE: 14,
  ACTION_ICON_STROKE: 1.75,

  // Heights
  TAB_ROW_HEIGHT: 40,
  HEADER_HEIGHT: 40,

  // Virtualization threshold
  VIRTUALIZATION_THRESHOLD: 100,
} as const;

// ============================================
// Default Message Keys (i18n)
// ============================================
// Resolve with t() at render time. Use HUMANTOOLS_TEXT_KEYS from shared for consistency.
// This config is for components that need default props; they pass t(key) as the default.

export const DEFAULT_MESSAGE_KEYS = {
  filterFiles: "placeholders.filterFiles",
  filterSearch: "placeholders.filterSearch",
  filterSourceControl: "placeholders.filterChanges",
  emptyFiles: "placeholders.noFilesFound",
  emptySearch: "placeholders.noResults",
  emptySourceControl: "placeholders.noChanges",
  tooltipFilter: "actions.filter",
  tooltipNewFile: "actions.newFile",
  tooltipNewFolder: "actions.newFolder",
  tooltipRefreshExplorer: "workstation.tooltipRefreshExplorer",
  tooltipCollapseAll: "workstation.tooltipCollapseAll",
  tooltipRefresh: "actions.refresh",
} as const;
