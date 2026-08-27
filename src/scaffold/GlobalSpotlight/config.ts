import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CenterFocusIcon from "@hugeicons/core-free-icons/CenterFocusIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import FolderClosedIcon from "@hugeicons/core-free-icons/FolderClosedIcon";
import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
import FolderSearchIcon from "@hugeicons/core-free-icons/FolderSearchIcon";
import FolderSymlinkIcon from "@hugeicons/core-free-icons/FolderSymlinkIcon";
import FolderTreeIcon from "@hugeicons/core-free-icons/FolderTreeIcon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import InternetIcon from "@hugeicons/core-free-icons/InternetIcon";
import LanguageCircleIcon from "@hugeicons/core-free-icons/LanguageCircleIcon";
import LaptopMinimalIcon from "@hugeicons/core-free-icons/LaptopMinimalIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import Layout01Icon from "@hugeicons/core-free-icons/Layout01Icon";
import Link02Icon from "@hugeicons/core-free-icons/Link02Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Pen01Icon from "@hugeicons/core-free-icons/Pen01Icon";
import Refresh04Icon from "@hugeicons/core-free-icons/Refresh04Icon";
import RocketIcon from "@hugeicons/core-free-icons/RocketIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import SquareArrowRight01Icon from "@hugeicons/core-free-icons/SquareArrowRight01Icon";
import SquareArrowUpRightIcon from "@hugeicons/core-free-icons/SquareArrowUpRightIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import WorkHistoryIcon from "@hugeicons/core-free-icons/WorkHistoryIcon";
import WorkflowCircle05Icon from "@hugeicons/core-free-icons/WorkflowCircle05Icon";

import { ACTION_ID } from "@src/ActionSystem";
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "@src/i18n";

import type { ActionDefinition } from "./types";

export { NAV_DESTINATIONS } from "./navDestinations";
export { searchNavDestinations } from "./navDestinationsSearch";
export type {
  NavDestination,
  NavDestinationGroup,
} from "./navDestinationsTypes";

// ============ ICON CONFIG ============

export const ICONS = {
  // Actions
  addWorkspace: SquareArrowRight01Icon,

  // Shared UI
  repo: CodeIcon,
  config: Settings01Icon,
  done: Tick01Icon,
  language: LanguageCircleIcon,

  // Workspace modes
  focusMode: CenterFocusIcon,
  stackMode: Layers01Icon,

  // Repo actions
  showFinder: FolderSearchIcon,

  // Add repo
  newRepo: FolderAddIcon,
  cloneRepo: LockIcon,
  cloneRepoUrl: Link02Icon,
  importRepo: FolderSymlinkIcon,

  // Navigation / Pages
  home: Home01Icon,
  workspace: FolderTreeIcon,
  workspaceLayout: Layout01Icon,
  folder: FolderClosedIcon,
  folderOpen: FolderOpenIcon,
  folderPlus: FolderAddIcon,

  // Tab types
  tabOpen: SquareArrowUpRightIcon,
  tabClosed: WorkHistoryIcon,
  tabChat: Message01Icon,
  tabAgent: SparklesIcon,

  // Misc
  refresh: Refresh04Icon,
  search: Search01Icon,
  branch: WorkflowCircle05Icon,
  worktree: FolderClosedIcon,
  close: Cancel01Icon,
  arrowRight: ArrowRight02Icon,
  arrowUp: ArrowUp02Icon,
  rocket: RocketIcon,
  back: ArrowLeft02Icon,
  emptyState: HelpCircleIcon,

  // AI/LLM
  aiSpark: SparklesIcon,

  // Selector-specific icons
  switchRepo: FolderTreeIcon,
  removeRepo: Delete02Icon,
  removeBranch: Delete02Icon,
  editRepo: Pen01Icon,
  recent: Clock01Icon,
  local: CodeIcon,
  github: GithubIcon,
  githubPublic: InternetIcon,
  githubPrivate: LockIcon,
  cloudSandbox: CloudIcon,
  localDevice: LaptopMinimalIcon,
} as const;

// ============ ACTIONS WITH REQUIRED PARAMS ============
// This is the core config - each action defines what parameters it needs

export const ACTIONS: ActionDefinition[] = [
  {
    id: ACTION_ID.SETTINGS_SET_LANGUAGE,
    label: "Change language",
    labelKey: "common:spotlightActions.changeLanguage",
    pillLabelKey: "common:spotlightActions.changeLanguage",
    icon: ICONS.language,
    color: "primary",
    requiredParams: ["language"],
    keywords: ["language", "locale", "translation", "i18n"],
    aliases: [
      "change language",
      "set language",
      "switch language",
      "app language",
      ...SUPPORTED_LANGUAGES,
      ...Object.values(LANGUAGE_NAMES),
    ],
  },

  // File actions - require repo
  {
    id: "show-in-finder",
    label: "Locate repo in Finder",
    labelKey: "selectors.spotlight.actions.showInFinder.label",
    pillLabelKey: "selectors.spotlight.actions.showInFinder.pillLabel",
    icon: ICONS.showFinder,
    color: "primary",
    requiredParams: ["repo"],
    keywords: ["finder", "folder", "reveal"],
    aliases: [
      "finder",
      "reveal",
      "show in finder",
      "explore",
      "open finder",
      "open folder",
      "show folder",
      "reveal in finder",
      "locate folder",
      "find folder",
      "open in finder",
      "browse files",
    ],
  },

  // Note: The legacy add-workspace action + sub-actions were removed. The
  // add workspace flow (Create / Clone URL / Clone GitHub / Import) now lives
  // entirely inside `WorkspacePalette` via `useAddWorkspaceFlow`, so GlobalSpotlight
  // doesn't need a top-level action entry for it.
];

// ============ HELPER: Get action by ID ============

export const getActionById = (id: string): ActionDefinition | undefined =>
  ACTIONS.find((actionItem) => actionItem.id === id);

// ============ TAG COLORS BY TYPE ============

export const TAG_COLORS: Record<string, string> = {
  action: "primary", // blue (primary-6)
  repo: "warning", // orange (warning-6)
  branch: "warning", // orange (warning-6)
  language: "success",
};

// ============ SPOTLIGHT POSITIONING CONFIG ============
// Re-export from constants.ts to avoid circular dependency
export { LIMITS, SPOTLIGHT_CONFIG } from "./constants";
