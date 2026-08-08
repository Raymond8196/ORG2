import { describe, expect, it } from "vitest";

import {
  type ChatPanelTabType,
  isChatPanelTabStationAvailable,
} from "../chatPanelTabsAtom";

describe("Chat Panel tab Station access", () => {
  it.each<ChatPanelTabType>(["session", "terminal", "start-page", "channel"])(
    "keeps Station access available for %s tabs",
    (type) => {
      expect(isChatPanelTabStationAvailable(type)).toBe(true);
    }
  );

  it.each<ChatPanelTabType>([
    "runtime",
    "team-inbox",
    "work-management",
    "workspace",
    "organization",
    "work-item",
    "github-issue",
    "github-pr",
    "project",
    "explore",
  ])("makes %s tabs full-screen and Station-free", (type) => {
    expect(isChatPanelTabStationAvailable(type)).toBe(false);
  });
});
