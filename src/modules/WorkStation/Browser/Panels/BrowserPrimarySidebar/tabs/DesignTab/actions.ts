/**
 * DesignTab header action factory functions
 *
 * These functions generate action button configurations for section headers.
 * Follows explorer pattern: Filter toggle, Collapse All, then other actions.
 */
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import FilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import ListChevronsDownUpIcon from "@hugeicons/core-free-icons/ListChevronsDownUpIcon";
import Refresh04Icon from "@hugeicons/core-free-icons/Refresh04Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { createElement } from "react";

import { ACTION_ICON_SIZE } from "./config";
import type {
  ActionItem,
  GlobalTokensActionsOptions,
  PagesActionsOptions,
} from "./types";

// ============================================
// Pages Actions
// ============================================

/**
 * Get header actions for Pages section
 * Follows explorer pattern: Filter toggle, Collapse All, then other actions
 */
export function getPagesActions({
  showFilter,
  onToggleFilter,
  onCollapseAll,
  onAddPage,
}: PagesActionsOptions): ActionItem[] {
  const actions: ActionItem[] = [
    {
      key: "filter",
      icon: createElement(HugeiconsIcon, {
        icon: FilterIcon,
        size: ACTION_ICON_SIZE,
        className: showFilter ? "text-primary-6" : "",
      }),
      tooltip: "Filter",
      onClick: onToggleFilter,
    },
  ];

  if (onCollapseAll) {
    actions.push({
      key: "collapse-all",
      icon: createElement(HugeiconsIcon, {
        icon: ListChevronsDownUpIcon,
        size: 16,
      }),
      tooltip: "Collapse All",
      onClick: onCollapseAll,
    });
  }

  if (onAddPage) {
    actions.push({
      key: "add-page",
      icon: createElement(HugeiconsIcon, {
        icon: Add01Icon,
        size: ACTION_ICON_SIZE,
      }),
      tooltip: "New Page",
      onClick: onAddPage,
    });
  }

  return actions;
}

// ============================================
// Global Tokens Actions
// ============================================

/**
 * Get header actions for Global Tokens section
 * Follows the same pattern as Added Components section
 */
export function getGlobalTokensActions({
  showFilter,
  onToggleFilter,
  onRefresh,
}: GlobalTokensActionsOptions): ActionItem[] {
  const actions: ActionItem[] = [
    {
      key: "filter",
      icon: createElement(HugeiconsIcon, {
        icon: FilterIcon,
        size: ACTION_ICON_SIZE,
        className: showFilter ? "text-primary-6" : "",
      }),
      tooltip: "Filter",
      onClick: onToggleFilter,
    },
  ];

  if (onRefresh) {
    actions.push({
      key: "refresh",
      icon: createElement(HugeiconsIcon, {
        icon: Refresh04Icon,
        size: ACTION_ICON_SIZE,
      }),
      tooltip: "Rescan Tokens",
      onClick: onRefresh,
    });
  }

  return actions;
}
