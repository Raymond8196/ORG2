import { describe, expect, it } from "vitest";

import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsAtom";
import type { Session } from "@src/store/session";

import {
  type ChatPanelTabDisplayLabels,
  resolveChatPanelTabDisplayTitle,
} from "./chatPanelTabDisplay";

const labels: ChatPanelTabDisplayLabels = {
  launchpad: "Launchpad",
  opsControl: "Ops Control",
  sessionFallback: "Chat",
};

function tab(type: ChatPanelTab["type"], title = "Launchpad"): ChatPanelTab {
  return { id: `tab-${type}`, type, title };
}

describe("resolveChatPanelTabDisplayTitle", () => {
  it("keeps navigation tab names isolated from surface titles", () => {
    expect(
      resolveChatPanelTabDisplayTitle(tab("ops-control"), null, labels)
    ).toBe("Ops Control");
    expect(
      resolveChatPanelTabDisplayTitle(tab("start-page"), null, labels)
    ).toBe("Launchpad");
  });

  it("uses the linked session instead of a leaked Launchpad title", () => {
    const session = {
      session_id: "session-1",
      name: "Fix tab naming",
      status: "completed",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    } as Session;

    expect(
      resolveChatPanelTabDisplayTitle(tab("session"), session, labels)
    ).toBe("Fix tab naming");
    expect(resolveChatPanelTabDisplayTitle(tab("session"), null, labels)).toBe(
      "Chat"
    );
  });
});
