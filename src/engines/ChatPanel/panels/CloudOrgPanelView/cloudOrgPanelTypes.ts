export type CloudOrgManagementTab = "general" | "sync" | "members";

export const CLOUD_ORG_MANAGEMENT_TAB = {
  GENERAL: "general",
  SYNC: "sync",
  MEMBERS: "members",
} as const satisfies Record<string, CloudOrgManagementTab>;

export type SelectValue = string | number | (string | number)[];
