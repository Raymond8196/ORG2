import { describe, expect, it } from "vitest";

import {
  CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX,
  CHAT_PANEL_GLASS_SURFACE_CLASS,
  CHAT_PANEL_HEADER_STACK_HEIGHT_PX,
  CHAT_PANEL_HEADER_TOP_PADDING_PX,
  CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX,
  CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX,
  CHAT_PANEL_TRANSCRIPT_TOP_PADDING_PX,
  resolveChatPanelChromeTopInsetPx,
  resolveTranscriptTopPaddingPx,
  shouldCollapseChatPanelTabRow,
  shouldOfferCollapsedTabClose,
  shouldOverlayChatSessionHeaders,
} from "./chatPanelHeaderLayout";

describe("chat panel header overlay", () => {
  it("uses a dense glass fill so scrolled content stays subdued", () => {
    expect(CHAT_PANEL_GLASS_SURFACE_CLASS).toContain("bg-chat-pane/70");
    expect(CHAT_PANEL_GLASS_SURFACE_CLASS).toContain("backdrop-blur-xl");
  });

  it("floats the full header stack for every ordinary session view", () => {
    expect(
      shouldOverlayChatSessionHeaders({
        showSessionContent: true,
        standaloneToolTabActive: false,
        humanSessionActive: false,
      })
    ).toBe(true);
    expect(CHAT_PANEL_HEADER_STACK_HEIGHT_PX).toBe(80);
  });

  it.each([
    [false, false, false],
    [true, true, false],
    [true, false, true],
  ])(
    "keeps non-session and human-session headers in normal flow",
    (showSessionContent, standaloneToolTabActive, humanSessionActive) => {
      expect(
        shouldOverlayChatSessionHeaders({
          showSessionContent,
          standaloneToolTabActive,
          humanSessionActive,
        })
      ).toBe(false);
    }
  );
});

describe("transcript top padding under floating chrome", () => {
  it("moves the chrome share to the pinned host when it renders in flow", () => {
    expect(
      resolveTranscriptTopPaddingPx(CHAT_PANEL_HEADER_STACK_HEIGHT_PX, true)
    ).toBe(CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX);
  });

  it("keeps the full padding when the transcript scrolls behind the chrome", () => {
    expect(
      resolveTranscriptTopPaddingPx(CHAT_PANEL_HEADER_STACK_HEIGHT_PX, false)
    ).toBe(CHAT_PANEL_TRANSCRIPT_TOP_PADDING_PX);
  });

  it("keeps the full padding when the chrome is rendered in flow", () => {
    expect(resolveTranscriptTopPaddingPx(0, true)).toBe(
      CHAT_PANEL_TRANSCRIPT_TOP_PADDING_PX
    );
    expect(resolveTranscriptTopPaddingPx(0, false)).toBe(
      CHAT_PANEL_TRANSCRIPT_TOP_PADDING_PX
    );
  });
});

describe("collapsing the tab row into the published header", () => {
  it("folds a maximized pane that holds a single tab", () => {
    expect(
      shouldCollapseChatPanelTabRow({ chatMaximized: true, tabCount: 1 })
    ).toBe(true);
  });

  it("keeps the row whenever a second tab exists to switch to", () => {
    expect(
      shouldCollapseChatPanelTabRow({ chatMaximized: true, tabCount: 2 })
    ).toBe(false);
  });

  it("keeps the row while the pane shares the workbench with a Station", () => {
    expect(
      shouldCollapseChatPanelTabRow({ chatMaximized: false, tabCount: 1 })
    ).toBe(false);
  });

  it("keeps the window-edge gap the folded tab row used to hold", () => {
    // The tab row's pt-2; the collapsed row inherits the top edge and the gap.
    expect(CHAT_PANEL_HEADER_TOP_PADDING_PX).toBe(8);
    expect(CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX).toBe(
      CHAT_PANEL_PUBLISHED_HEADER_HEIGHT_PX + CHAT_PANEL_HEADER_TOP_PADDING_PX
    );
  });

  it("floats only the collapsed row's height once collapsed", () => {
    expect(resolveChatPanelChromeTopInsetPx(true, true)).toBe(
      CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX
    );
    expect(resolveChatPanelChromeTopInsetPx(true, false)).toBe(
      CHAT_PANEL_HEADER_STACK_HEIGHT_PX
    );
    expect(resolveChatPanelChromeTopInsetPx(false, true)).toBe(0);
  });

  it("shrinks the transcript padding to match the collapsed chrome", () => {
    expect(
      resolveTranscriptTopPaddingPx(
        CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX,
        false
      )
    ).toBe(
      CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX + CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX
    );
    expect(
      resolveTranscriptTopPaddingPx(CHAT_PANEL_COLLAPSED_HEADER_HEIGHT_PX, true)
    ).toBe(CHAT_PANEL_TRANSCRIPT_TOP_GAP_PX);
  });
});

describe("collapsed close control", () => {
  it("is withheld on the Launchpad, which closing would only recreate", () => {
    expect(shouldOfferCollapsedTabClose("start-page")).toBe(false);
  });

  it("is offered for every surface the user can actually close away", () => {
    for (const type of ["session", "terminal", "runtime", "channel"]) {
      expect(shouldOfferCollapsedTabClose(type)).toBe(true);
    }
  });

  it("is withheld when there is no active tab to close", () => {
    expect(shouldOfferCollapsedTabClose(null)).toBe(false);
    expect(shouldOfferCollapsedTabClose(undefined)).toBe(false);
  });
});
