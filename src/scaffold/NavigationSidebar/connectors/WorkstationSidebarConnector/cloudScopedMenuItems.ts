import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import { separator } from "../useSessionMenuItems/menuItemBuilders";

export const CLOUD_MY_SESSIONS_SECTION_ID = "cloud-my-sessions";

interface BuildCloudScopedMenuItemsParams {
  cloudMenuItems: readonly NavigationMenuItem[];
  sessionMenuItems: readonly NavigationMenuItem[];
  mySessionsLabel: string;
}

/**
 * Cloud scope has two top-level sections: shared team sessions and the
 * viewer's own sessions. Local grouping separators are removed so every
 * regular local row belongs to the single "My sessions" section.
 */
export function buildCloudScopedMenuItems({
  cloudMenuItems,
  sessionMenuItems,
  mySessionsLabel,
}: BuildCloudScopedMenuItemsParams): NavigationMenuItem[] {
  if (cloudMenuItems.length === 0) return [...sessionMenuItems];

  const localRows = sessionMenuItems.filter(
    (item) => !item.id.startsWith("separator-")
  );

  return [
    ...cloudMenuItems,
    separator(CLOUD_MY_SESSIONS_SECTION_ID, mySessionsLabel),
    ...localRows,
  ];
}
