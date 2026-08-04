import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import { separator } from "../useSessionMenuItems/menuItemBuilders";

export const CLOUD_MY_SESSIONS_SECTION_ID = "cloud-my-sessions";
export const CLOUD_PINNED_SECTION_ID = "cloud-pinned";
export const CLOUD_TEAM_SESSIONS_SECTION_ID = "cloud-team-sessions";
export const CLOUD_SESSION_SECTION_PAGE_SIZE = 10;
export const CLOUD_TEAM_SESSIONS_LOAD_MORE_ID = "cloud-team-sessions-next-page";
export const CLOUD_MY_SESSIONS_LOAD_MORE_ID = "cloud-my-sessions-next-page";

interface BuildCloudScopedMenuItemsParams {
  cloudMenuItems: readonly NavigationMenuItem[];
  sessionMenuItems: readonly NavigationMenuItem[];
  mySessionsLabel: string;
  pinnedLabel?: string;
  mySessionsVisibleCount?: number;
  loadMoreLabel?: string;
}

const PINNED_SEPARATOR_ID = "separator-pinned";
const LOCAL_GROUP_PAGER_PREFIX = "load-more-group-";

export function isSessionPaginationMenuItem(item: NavigationMenuItem): boolean {
  return item.id.startsWith("load-more-");
}

/**
 * A backend stream pager (`load-more-<category>`), as opposed to a local
 * "show more of this group" pager (`load-more-group-<group>`), whose id also
 * begins with `load-more-`. Only the former speaks for a stream that can fetch
 * another page from Rust.
 */
function isBackendStreamPager(item: NavigationMenuItem): boolean {
  return (
    isSessionPaginationMenuItem(item) &&
    !item.id.startsWith(LOCAL_GROUP_PAGER_PREFIX)
  );
}

export function isCloudScopedLocalRow(item: NavigationMenuItem): boolean {
  return (
    !item.id.startsWith("separator-") && !isSessionPaginationMenuItem(item)
  );
}

export function buildCloudSectionLoadMoreItem({
  id,
  label,
  disabled = false,
  trailingElement,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  trailingElement?: ReactNode;
}): NavigationMenuItem {
  return {
    id,
    key: id,
    label,
    icon: MoreHorizontal,
    iconName: "more-horizontal",
    visualTone: "secondary",
    disabled,
    trailingElement,
  };
}

/**
 * Cloud scope has three top-level sections: shared team sessions, the pinned
 * rows the viewer lifted out, and everything else of theirs. The *date*
 * grouping separators are removed so every ordinary local row belongs to the
 * single "My sessions" section — but Pinned is not a date bucket, it is user
 * intent, and pinning is a capability of every session in every org. Dropping
 * its header with the date headers left a pinned row indistinguishable from
 * the rest of the list, which read as "cloud orgs cannot pin".
 */
export function buildCloudScopedMenuItems({
  cloudMenuItems,
  sessionMenuItems,
  mySessionsLabel,
  pinnedLabel = "Pinned",
  mySessionsVisibleCount = CLOUD_SESSION_SECTION_PAGE_SIZE,
  loadMoreLabel = "Load more",
}: BuildCloudScopedMenuItemsParams): NavigationMenuItem[] {
  if (cloudMenuItems.length === 0) return [...sessionMenuItems];

  // Walk in order tracking which separator each row follows, so the pinned
  // block can be lifted out whole. A flat `filter` cannot do this: once the
  // separators are gone there is no way to tell a pinned row from any other.
  const pinnedItems: NavigationMenuItem[] = [];
  const localRows: NavigationMenuItem[] = [];
  const backendPaginationItems: NavigationMenuItem[] = [];
  let inPinnedGroup = false;
  for (const item of sessionMenuItems) {
    if (item.id.startsWith("separator-")) {
      inPinnedGroup = item.id === PINNED_SEPARATOR_ID;
      continue;
    }
    if (isBackendStreamPager(item)) {
      backendPaginationItems.push(item);
      continue;
    }
    if (inPinnedGroup) {
      pinnedItems.push(item);
      continue;
    }
    // A date group's own "show more" pager is meaningless once that group is
    // flattened into My sessions — the section's own pager governs from here.
    if (item.id.startsWith(LOCAL_GROUP_PAGER_PREFIX)) continue;
    localRows.push(item);
  }
  const visibleLocalRows = localRows.slice(0, mySessionsVisibleCount);
  const hasHiddenLoadedRows = localRows.length > visibleLocalRows.length;
  const readyBackendPaginationItem = backendPaginationItems.find(
    (item) => !item.disabled
  );
  const loadingBackendPaginationItem = backendPaginationItems.find(
    (item) => item.disabled
  );
  const hasMore = hasHiddenLoadedRows || backendPaginationItems.length > 0;
  const mySessionsItems = hasMore
    ? [
        ...visibleLocalRows,
        buildCloudSectionLoadMoreItem({
          id: CLOUD_MY_SESSIONS_LOAD_MORE_ID,
          label:
            !hasHiddenLoadedRows && !readyBackendPaginationItem
              ? (loadingBackendPaginationItem?.label ?? loadMoreLabel)
              : loadMoreLabel,
          disabled:
            !hasHiddenLoadedRows && readyBackendPaginationItem === undefined,
          trailingElement:
            !hasHiddenLoadedRows && readyBackendPaginationItem === undefined
              ? loadingBackendPaginationItem?.trailingElement
              : undefined,
        }),
      ]
    : visibleLocalRows;

  return [
    ...cloudMenuItems,
    ...(pinnedItems.length > 0
      ? [separator(CLOUD_PINNED_SECTION_ID, pinnedLabel), ...pinnedItems]
      : []),
    separator(CLOUD_MY_SESSIONS_SECTION_ID, mySessionsLabel),
    ...mySessionsItems,
  ];
}
