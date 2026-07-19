import { describe, expect, it } from "vitest";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import {
  CLOUD_MY_SESSIONS_SECTION_ID,
  buildCloudScopedMenuItems,
} from "./cloudScopedMenuItems";

describe("buildCloudScopedMenuItems", () => {
  const localSections: NavigationMenuItem[] = [
    { id: "separator-today", key: "separator-today", label: "Today" },
    { id: "session-today", key: "session-today", label: "Today session" },
    {
      id: "separator-yesterday",
      key: "separator-yesterday",
      label: "Yesterday",
    },
    {
      id: "session-yesterday",
      key: "session-yesterday",
      label: "Yesterday session",
    },
  ];

  it("keeps regular grouping unchanged outside cloud scope", () => {
    expect(
      buildCloudScopedMenuItems({
        cloudMenuItems: [],
        sessionMenuItems: localSections,
        mySessionsLabel: "My sessions",
      })
    ).toEqual(localSections);
  });

  it("flattens regular rows into one My sessions section in cloud scope", () => {
    const teamItems: NavigationMenuItem[] = [
      {
        id: "separator-cloud-team-sessions",
        key: "separator-cloud-team-sessions",
        label: "Team sessions",
      },
      { id: "team-session", key: "team-session", label: "Team session" },
    ];

    const result = buildCloudScopedMenuItems({
      cloudMenuItems: teamItems,
      sessionMenuItems: localSections,
      mySessionsLabel: "My sessions",
    });

    expect(result).toEqual([
      ...teamItems,
      {
        id: `separator-${CLOUD_MY_SESSIONS_SECTION_ID}`,
        key: `separator-${CLOUD_MY_SESSIONS_SECTION_ID}`,
        label: "My sessions",
      },
      localSections[1],
      localSections[3],
    ]);
  });

  it("renders the My sessions section even when it has no local rows", () => {
    expect(
      buildCloudScopedMenuItems({
        cloudMenuItems: [
          {
            id: "separator-cloud-team-sessions",
            key: "separator-cloud-team-sessions",
            label: "Team sessions",
          },
        ],
        sessionMenuItems: [],
        mySessionsLabel: "My sessions",
      })
    ).toEqual([
      {
        id: "separator-cloud-team-sessions",
        key: "separator-cloud-team-sessions",
        label: "Team sessions",
      },
      {
        id: `separator-${CLOUD_MY_SESSIONS_SECTION_ID}`,
        key: `separator-${CLOUD_MY_SESSIONS_SECTION_ID}`,
        label: "My sessions",
      },
    ]);
  });
});
