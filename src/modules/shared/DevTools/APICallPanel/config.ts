// ============================================
// Icon Configuration
// ============================================
import Network from "@hugeicons/core-free-icons/AiNetworkIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import MousePointerClick from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import Zap from "@hugeicons/core-free-icons/FlashIcon";
import Keyboard from "@hugeicons/core-free-icons/KeyboardIcon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Target from "@hugeicons/core-free-icons/Target01Icon";
import Eye from "@hugeicons/core-free-icons/ViewIcon";

export const ICON_CONFIG = {
  // Action icons
  close: X,
  delete: Trash2,

  // Panel icons
  api: Network,

  // Trigger icons
  triggerClick: MousePointerClick,
  triggerHover: Eye,
  triggerKeyboard: Keyboard,
  triggerFocus: Target,
  triggerAuto: Zap,
} as const;

// ============================================
// Empty State Icon
// ============================================

export const EMPTY_STATE_ICONS = {
  all: Search,
} as const;
