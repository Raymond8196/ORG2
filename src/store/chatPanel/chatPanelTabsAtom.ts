/**
 * Public compatibility surface for Chat Panel tab state.
 *
 * The implementation is split by responsibility so persistence, presentation
 * synchronization, tab creation, and lifecycle mutations remain independently
 * understandable. Keep consumers importing this module so atom identities and
 * the public API stay centralized.
 */
export {
  clearChatPanelTabCliCommandAtom,
  closeAndDestroyChatPanelTabAtom,
  closeChatPanelTabAtom,
  closeCloudOrgManagementChatPanelTabAtom,
  nextChatPanelTabAtom,
  prevChatPanelTabAtom,
  reorderChatPanelTabsAtom,
  setChatPanelTabSessionIdAtom,
  setChatPanelTabTitleAtom,
  toggleChatPanelTabTuiModeAtom,
} from "./chatPanelTabLifecycleAtoms";
export {
  addChatPanelLaunchpadTabAtom,
  addChatPanelTerminalTabAtom,
  openCloudOrgManagementInChatPanelTabAtom,
  openKanbanChatPanelTabAtom,
  openOrFocusChatPanelManageTabAtom,
  openOrFocusChatPanelStartPageTabAtom,
  openOrFocusSessionInChatPanelTabAtom,
  openOrReplaceSessionInChatPanelTabAtom,
  openSessionInNewChatTabAtom,
  openWorkspaceOverviewInChatPanelTabAtom,
} from "./chatPanelTabOpenAtoms";
export {
  activateChatPanelTabAtom,
  syncActiveChatPanelTabStateAtom,
} from "./chatPanelTabPresentationAtoms";
export {
  normalizePersistedChatPanelTabsState,
  type ChatPanelTab,
  type ChatPanelTabsState,
  type ChatPanelTabType,
} from "./chatPanelTabsModel";
export {
  activeChatPanelTabAtom,
  activeWorkManagementSectionAtom,
  chatPanelTabCountAtom,
  chatPanelTabsAtom,
} from "./chatPanelTabsState";
