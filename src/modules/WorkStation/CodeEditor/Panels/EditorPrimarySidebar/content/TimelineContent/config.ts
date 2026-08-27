/**
 * TimelineSection Configuration
 */
import DiffIcon from "@hugeicons/core-free-icons/DiffIcon";
import GitCommitIcon from "@hugeicons/core-free-icons/GitCommitIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import Refresh04Icon from "@hugeicons/core-free-icons/Refresh04Icon";

// Icon configuration
export const TIMELINE_ICONS = {
  commit: GitCommitIcon,
  pin: PinIcon,
  refresh: Refresh04Icon,
  openDiff: DiffIcon,
} as const;

// Constants
export const TIMELINE_CONSTANTS = {
  MAX_COMMITS: 50,
  ICON_SIZE: 12,
  ACTION_ICON_SIZE: 14,
  ENTRY_HEIGHT: 56,
} as const;
