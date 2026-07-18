import type {
  ChatPanelSelectedCloudOrg,
  ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";
import {
  WORK_MANAGEMENT_SECTION,
  type WorkManagementSection,
} from "@src/store/workstation/workstationTabBarAtoms";

export type ChatPanelTabType =
  | "session"
  | "terminal"
  | "start-page"
  | "work-management"
  | "workspace"
  | "cloud-org";

export interface ChatPanelTab {
  id: string;
  type: ChatPanelTabType;
  /** Display label */
  title: string;
  /** Active inner section for the singleton Kanban tab. */
  managementSection?: WorkManagementSection;
  createdAt?: string;
  updatedAt?: string;
  /**
   * For "session" tabs: the linked ORGII session ID.
   * Legacy persisted empty tabs may still hydrate with null before migration.
   */
  sessionId?: string | null;
  /**
   * For "terminal" tabs: the terminal session ID in the shared terminal
   * atom store. Always prefixed "chatpanel-<uuid>" to isolate from
   * Workstation terminals.
   */
  terminalSessionId?: string;
  /**
   * When true the terminal / session output is forced through xterm.js
   * instead of ansi-to-react.
   */
  tuiMode?: boolean;
  /**
   * For "terminal" tabs opened via the CLI launch bar: the bare binary command
   * to write to the PTY once the shell prompt is ready (e.g. "claude\n").
   * Written once after the PTY reports initialized; cleared afterwards.
   */
  cliCommand?: string;
  /**
   * For "workspace" tabs: the workspace whose overview / detail page this pill
   * owns. Activating the tab replays this into `chatPanelSelectedWorkspaceAtom`
   * (via `chatPanelNavigateAtom`) so the overview surface re-renders.
   */
  workspace?: ChatPanelSelectedWorkspace;
  /**
   * For "cloud-org" tabs: the managed organization restored when this tab
   * is activated. The management page itself provides the org switcher.
   */
  cloudOrg?: ChatPanelSelectedCloudOrg;
}

export interface ChatPanelTabsState {
  tabs: ChatPanelTab[];
  activeTabId: string;
}

const DEFAULT_FULLSCREEN_CHAT_PANEL_TAB_TYPES = new Set<ChatPanelTabType>([
  "work-management",
]);

export function isChatPanelTabDefaultFullscreen(
  tabOrType: ChatPanelTab | ChatPanelTabType | null | undefined
): boolean {
  const type =
    typeof tabOrType === "string" ? tabOrType : (tabOrType?.type ?? null);
  return type !== null && DEFAULT_FULLSCREEN_CHAT_PANEL_TAB_TYPES.has(type);
}

export function getWorkManagementFallbackTitle(
  section: WorkManagementSection
): string {
  switch (section) {
    case WORK_MANAGEMENT_SECTION.PROJECTS:
      return "Projects";
    case WORK_MANAGEMENT_SECTION.GITHUB_ISSUES:
      return "GitHub Issues";
    case WORK_MANAGEMENT_SECTION.GITHUB_PRS:
      return "GitHub PRs";
    case WORK_MANAGEMENT_SECTION.KANBAN:
      return "Kanban";
  }
}

export function normalizePersistedChatPanelTabsState(
  value: unknown
): ChatPanelTabsState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ChatPanelTabsState>;
  if (!Array.isArray(candidate.tabs)) return null;

  const mappedTabs = candidate.tabs
    .filter((tab) => tab.type !== "terminal")
    .map((tab) => {
      const persistedType = (tab as { type: string }).type;
      if (persistedType === "session" && !tab.sessionId) {
        return {
          ...tab,
          type: "start-page",
          title: "Launchpad",
        } as ChatPanelTab;
      }
      if (persistedType === "launchpad" || persistedType === "dashboard") {
        return {
          ...tab,
          type: "start-page",
          title: "Launchpad",
        } as ChatPanelTab;
      }
      if (persistedType === "work-management") {
        const managementSection =
          tab.managementSection ?? WORK_MANAGEMENT_SECTION.KANBAN;
        return {
          ...tab,
          title: getWorkManagementFallbackTitle(managementSection),
          managementSection,
        } as ChatPanelTab;
      }
      return tab;
    });

  const activeMappedTab = mappedTabs.find(
    (tab) => tab.id === candidate.activeTabId
  );
  const preferredWorkManagementTabId =
    activeMappedTab?.type === "work-management"
      ? activeMappedTab.id
      : mappedTabs.find((tab) => tab.type === "work-management")?.id;
  const preferredCloudOrgTabId =
    activeMappedTab?.type === "cloud-org"
      ? activeMappedTab.id
      : mappedTabs.find((tab) => tab.type === "cloud-org")?.id;
  // The Launchpad start page is a singleton: collapse any persisted duplicates
  // to a single tab (preferring the active one) so new-session / launchpad
  // entry points can never stack more than one.
  const preferredStartPageTabId =
    activeMappedTab?.type === "start-page"
      ? activeMappedTab.id
      : mappedTabs.find((tab) => tab.type === "start-page")?.id;
  const survivingTabs = mappedTabs.filter(
    (tab) =>
      (tab.type !== "work-management" ||
        tab.id === preferredWorkManagementTabId) &&
      (tab.type !== "cloud-org" || tab.id === preferredCloudOrgTabId) &&
      (tab.type !== "start-page" || tab.id === preferredStartPageTabId)
  );
  if (survivingTabs.length === 0) return null;

  const activeTabId = survivingTabs.some(
    (tab) => tab.id === candidate.activeTabId
  )
    ? (candidate.activeTabId as string)
    : survivingTabs[0].id;
  return { tabs: survivingTabs, activeTabId };
}

const DEFAULT_LAUNCHPAD_TAB_ID = "launchpad-default";

export function buildDefaultLaunchpadTab(): ChatPanelTab {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_LAUNCHPAD_TAB_ID,
    type: "start-page",
    title: "Launchpad",
    createdAt: now,
    updatedAt: now,
  };
}

export function buildInitialChatPanelTabsState(): ChatPanelTabsState {
  const launchpad = buildDefaultLaunchpadTab();
  return {
    tabs: [launchpad],
    activeTabId: launchpad.id,
  };
}
