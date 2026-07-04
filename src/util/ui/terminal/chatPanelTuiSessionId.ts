const CHAT_PANEL_TUI_SESSION_PREFIX = "chatpaneltui-";

export function toChatPanelTuiSessionId(tabId: string): string {
  return `${CHAT_PANEL_TUI_SESSION_PREFIX}${tabId}`;
}

export function isChatPanelTuiSessionId(
  sessionId: string | null | undefined
): boolean {
  return Boolean(sessionId?.startsWith(CHAT_PANEL_TUI_SESSION_PREFIX));
}

export function getChatPanelTabIdFromTuiSessionId(sessionId: string): string {
  return sessionId.startsWith(CHAT_PANEL_TUI_SESSION_PREFIX)
    ? sessionId.slice(CHAT_PANEL_TUI_SESSION_PREFIX.length)
    : "";
}
