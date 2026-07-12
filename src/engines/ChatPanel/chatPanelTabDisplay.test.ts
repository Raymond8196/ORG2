import { describe, expect, it } from "vitest";

import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsAtom";
import type { Session } from "@src/store/session";
import { OPS_CONTROL_HOME_TAB } from "@src/store/workstation";

import {
  type ChatPanelTabDisplayLabels,
  resolveChatPanelTabDisplayTitle,
} from "./chatPanelTabDisplay";

const labels: ChatPanelTabDisplayLabels = {
  launchpad: "Launchpad",
  opsControl: {
    kanban: "Kanban",
    projects: "Projects",
    githubIssues: "GitHub Issues",
    githubPrs: "GitHub PRs",
  },
  sessionFallback: "Chat",
};

function tab(
  type: ChatPanelTab["type"],
  title = "Launchpad",
  opsSection?: ChatPanelTab["opsSection"]
): ChatPanelTab {
  return { id: `tab-${type}`, type, title, opsSection };
}

describe("resolveChatPanelTabDisplayTitle", () => {
  it("uses the active management destination as the localized tab title", () => {
    expect(
      resolveChatPanelTabDisplayTitle(tab("ops-control"), null, labels)
    ).toBe("Kanban");
    expect(
      resolveChatPanelTabDisplayTitle(
        tab("ops-control", "Ignored", OPS_CONTROL_HOME_TAB.PROJECTS),
        null,
        labels
      )
    ).toBe("Projects");
    expect(
      resolveChatPanelTabDisplayTitle(
        tab("ops-control", "Ignored", OPS_CONTROL_HOME_TAB.GITHUB_ISSUES),
        null,
        labels
      )
    ).toBe("GitHub Issues");
    expect(
      resolveChatPanelTabDisplayTitle(
        tab("ops-control", "Ignored", OPS_CONTROL_HOME_TAB.GITHUB_PRS),
        null,
        labels
      )
    ).toBe("GitHub PRs");
  });

  it("keeps the Launchpad tab name isolated from surface titles", () => {
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
