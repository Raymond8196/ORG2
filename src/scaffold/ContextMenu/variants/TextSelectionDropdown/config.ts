/**
 * TextSelectionDropdown Configuration
 *
 * Configuration for the text selection dropdown that appears
 * when text is selected in terminal, browser, or editor views.
 */
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import FileScriptIcon from "@hugeicons/core-free-icons/FileScriptIcon";
import MessageCircleQuestionMarkIcon from "@hugeicons/core-free-icons/MessageCircleQuestionMarkIcon";
import TextQuoteIcon from "@hugeicons/core-free-icons/TextQuoteIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import WorkHistoryIcon from "@hugeicons/core-free-icons/WorkHistoryIcon";
import type { IconSvgElement } from "@hugeicons/react";

// ============================================
// Types
// ============================================

export type DropdownAction =
  | "ask-agent"
  | "add-to-chat"
  | "add-to-context"
  | "add-file"
  | "add-lines";

export interface DropdownMenuItem {
  id: DropdownAction;
  label: string;
  icon: IconSvgElement;
  hasSecondLayer?: boolean;
}

export interface SessionItem {
  sessionId: string;
  name: string;
  isNew?: boolean;
}

// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  askAgent: MessageCircleQuestionMarkIcon,
  addContext: Add01Icon,
  addFile: FileScriptIcon,
  addLines: TextQuoteIcon,
  session: WorkHistoryIcon,
  newSession: Add01Icon,
  arrow: ArrowRight02Icon,
  arrowBack: ArrowLeft02Icon,
  check: Tick01Icon,
} as const;

// ============================================
// Menu Configuration
// ============================================

// Menu items for terminal/browser — single action, no session picker
export const MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "add-to-chat",
    label: "Add to Chat",
    icon: ICON_CONFIG.addContext,
    hasSecondLayer: false,
  },
];

// Menu items for editor
export const EDITOR_MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "add-file",
    label: "Add this file to agent",
    icon: ICON_CONFIG.addFile,
    hasSecondLayer: false,
  },
  {
    id: "add-lines",
    label: "Add line {from} ~ {to} to agent",
    icon: ICON_CONFIG.addLines,
    hasSecondLayer: false,
  },
];

// ============================================
// Style Configuration
// ============================================

export const STYLE_CONFIG = {
  dropdownWidth: "180px",
  secondLayerWidth: "240px",
  maxHeight: "240px",
  itemHeight: "36px",
  zIndex: 99999,
} as const;

// ============================================
// Keyboard Shortcuts
// ============================================

export const KEYBOARD_CONFIG = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  enter: "Enter",
  escape: "Escape",
} as const;
