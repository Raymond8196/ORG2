import type { TFunction } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatPanelStartPage } from "./ChatPanelStartPage";

const mocks = vi.hoisted(() => ({
  useAvailableAppUpdate: vi.fn(),
}));

vi.mock("@src/scaffold/AppUpdater", () => ({
  useAvailableAppUpdate: mocks.useAvailableAppUpdate,
}));

describe("ChatPanelStartPage", () => {
  it("renders the install-latest-update work action", () => {
    mocks.useAvailableAppUpdate.mockReturnValue({
      available: true,
      version: "1.1.20",
    });
    const t = ((key: string) => {
      if (key === "chat.startPage.installLatestUpdate.title") {
        return "Install latest update";
      }
      return key;
    }) as TFunction<["sessions", "common", "projects", "navigation"]>;

    const markup = renderToStaticMarkup(
      createElement(ChatPanelStartPage, {
        onAddApiKey: vi.fn(),
        onExploreRepos: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        onManageIssues: vi.fn(),
        onNewSession: vi.fn(),
        onNewWorkItem: vi.fn(),
        onSetupRepo: vi.fn(),
        t,
      })
    );

    expect(markup).toContain(
      'data-testid="chat-panel-start-page-install-latest-update"'
    );
    expect(markup).toContain("Install latest update");
    expect(markup).toContain("text-primary-6");
  });

  it("hides the install action when no update has been detected", () => {
    mocks.useAvailableAppUpdate.mockReturnValue(null);
    const t = ((key: string) => key) as TFunction<
      ["sessions", "common", "projects", "navigation"]
    >;

    const markup = renderToStaticMarkup(
      createElement(ChatPanelStartPage, {
        onAddApiKey: vi.fn(),
        onExploreRepos: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        onManageIssues: vi.fn(),
        onNewSession: vi.fn(),
        onNewWorkItem: vi.fn(),
        onSetupRepo: vi.fn(),
        t,
      })
    );

    expect(markup).not.toContain(
      'data-testid="chat-panel-start-page-install-latest-update"'
    );
  });
});
