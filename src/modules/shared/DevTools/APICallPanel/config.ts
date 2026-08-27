// ============================================
// Icon Configuration
// ============================================
import AiNetworkIcon from "@hugeicons/core-free-icons/AiNetworkIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CursorPointer02Icon from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import KeyboardIcon from "@hugeicons/core-free-icons/KeyboardIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Target01Icon from "@hugeicons/core-free-icons/Target01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";

export const ICON_CONFIG = {
  // Action icons
  close: Cancel01Icon,
  delete: Delete02Icon,

  // Panel icons
  api: AiNetworkIcon,

  // Trigger icons
  triggerClick: CursorPointer02Icon,
  triggerHover: ViewIcon,
  triggerKeyboard: KeyboardIcon,
  triggerFocus: Target01Icon,
  triggerAuto: FlashIcon,
} as const;

// ============================================
// Empty State Icon
// ============================================

export const EMPTY_STATE_ICONS = {
  all: Search01Icon,
} as const;
