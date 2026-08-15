// Editor & Code Hooks
export { useDiff } from "./git/useDiff";
export { useContextMenu } from "./panels/useContextMenu";

export { useCursorSessionCapture } from "./sessionCapture/useCursorSessionCapture";
export {
  useWorkStationPanels,
  usePrimarySidebarState,
  useBottomPanelState,
} from "./panels/useWorkStationPanels";
export { useSelectedFile } from "./tabs/useSelectedFile";

// Unified tab management
export {
  useWorkStationTabs,
  useCloseTabWithGuard,
  useFocusTab,
  usePinnedTabs,
} from "./tabs";
export type { UseWorkStationTabsReturn } from "./tabs";

// Browser-specific hooks - import directly from files to avoid circular dependencies
// DO NOT re-export from ./browser index due to circular dependency issues
// Import directly: import { useBrowserPaneState } from "@src/hooks/workStation/browser/useBrowserPaneState"
// Import directly: import { useBrowserSessions } from "@src/hooks/workStation/browser/useBrowserSessions"

// Editor-specific hooks
export { useCodeEditorEvents } from "./editor/useCodeEditorEvents";
export type { CodeEditorEventsOptions } from "./editor/useCodeEditorEvents";

export { useWorkStationTabShortcutBridge } from "./useWorkStationTabShortcutBridge";
export type { WorkStationTabShortcutBridgeOptions } from "./useWorkStationTabShortcutBridge";

export { usePublishWorkstationTabHeader } from "./useWorkstationTabHeader";
export type { WorkstationTabHeaderHost } from "./useWorkstationTabHeader";

export {
  useNarrowChatFocus,
  NARROW_CHAT_FOCUS_BREAKPOINT_PX,
} from "./useNarrowChatFocus";
