export const CHAT_PANEL_TAB_HEADER_HEIGHT_PX = 44;
export const CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX = 36;
/**
 * Gap above whichever header row sits at the pane's top edge — the tab row's
 * `pt-2`. It keeps the row clear of the window edge and lines the row's
 * content band up with the host window controls beside it, so the row that
 * inherits the top edge has to inherit the gap too.
 */
export const CHAT_PANEL_HEADER_TOP_PADDING_PX = 8;
/** Collapsed chrome: the published row plus the top gap it inherited. */
export const CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX =
  CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX + CHAT_PANEL_HEADER_TOP_PADDING_PX;
export const CHAT_PANEL_HEADER_STACK_HEIGHT_PX =
  CHAT_PANEL_TAB_HEADER_HEIGHT_PX + CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX;
export const CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX = 24;
export const CHAT_PANEL_TRANSCRIPT_TOP_PADDING_PX =
  CHAT_PANEL_HEADER_STACK_HEIGHT_PX + CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX;

/** Dense glass shared by the chat header stack and its pinned subheaders. */
export const CHAT_PANEL_GLASS_SURFACE_CLASS =
  "bg-chat-pane/70 backdrop-blur-xl backdrop-saturate-150";

interface ChatPanelHeaderOverlayState {
  showSessionContent: boolean;
  standaloneToolTabActive: boolean;
  humanSessionActive: boolean;
}

/** Transcript top padding: the chrome share moves to the pinned-header host when it renders in flow. */
export function resolveTranscriptTopPaddingPx(
  chromeTopInset: number,
  pinnedHeaderLayerInFlow: boolean
): number {
  if (chromeTopInset > 0 && pinnedHeaderLayerInFlow) {
    return CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX;
  }
  // A collapsed header stack floats less chrome, so the transcript reserves
  // the inset it was actually given rather than the full two-row height.
  const floatingChromePx =
    chromeTopInset > 0 ? chromeTopInset : CHAT_PANEL_HEADER_STACK_HEIGHT_PX;
  return floatingChromePx + CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX;
}

interface ChatPanelTabRowCollapseState {
  /** Whether the pane currently owns the full workbench width. */
  chatMaximized: boolean;
  tabCount: number;
}

/**
 * Whether the 44px tab row folds into the 40px published header.
 *
 * A maximized pane holding a single tab has nothing to switch between: the
 * lone pill only repeats the surface title published one row below it, so the
 * row costs 44px of chrome and buys nothing. Collapsing moves its controls
 * (new tab / close tab / restore) onto the published row, which is why that
 * row is force-rendered while collapsed even for surfaces that publish no
 * slots of their own.
 */
export function shouldCollapseChatPanelTabRow({
  chatMaximized,
  tabCount,
}: ChatPanelTabRowCollapseState): boolean {
  return chatMaximized && tabCount === 1;
}

/**
 * Whether the collapsed row offers a close control.
 *
 * Closing the pane's last tab reseeds a fresh Launchpad, so on the Launchpad
 * itself the control could only ever replace the page with a copy of itself.
 * Every other surface is genuinely closable.
 */
export function shouldOfferCollapsedTabClose(
  activeTabType: string | null | undefined
): boolean {
  return Boolean(activeTabType) && activeTabType !== "start-page";
}

/** Floating-chrome height the transcript scrolls beneath. */
export function resolveChatPanelChromeTopInsetPx(
  overlayHeaders: boolean,
  tabRowCollapsed: boolean
): number {
  if (!overlayHeaders) return 0;
  return tabRowCollapsed
    ? CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX
    : CHAT_PANEL_HEADER_STACK_HEIGHT_PX;
}

/** Session views share one floating glass-header contract in the chat pane. */
export function shouldOverlayChatSessionHeaders({
  showSessionContent,
  standaloneToolTabActive,
  humanSessionActive,
}: ChatPanelHeaderOverlayState): boolean {
  return showSessionContent && !standaloneToolTabActive && !humanSessionActive;
}
