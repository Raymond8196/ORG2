import { describe, expect, it } from "vitest";

import {
  CHAT_PANEL_GLASS_SURFACE_CLASS,
  CHAT_PANEL_HEADER_STACK_HEIGHT_PX,
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
    expect(CHAT_PANEL_HEADER_STACK_HEIGHT_PX).toBe(84);
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
