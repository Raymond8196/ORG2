export type CloudOrgManagementTab =
  | "general"
  | "sessions"
  | "repo-scope"
  | "members";

export const CLOUD_ORG_MANAGEMENT_TAB = {
  GENERAL: "general",
  SESSIONS: "sessions",
  REPO_SCOPE: "repo-scope",
  MEMBERS: "members",
} as const satisfies Record<string, CloudOrgManagementTab>;

export type SelectValue = string | number | (string | number)[];
