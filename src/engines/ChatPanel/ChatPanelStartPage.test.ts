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
  it("renders the install-latest-update action in More", () => {
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
        initialView: "more",
        onAddApiKey: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        t,
      })
    );

    expect(markup).toContain(
      'data-testid="chat-panel-start-page-install-latest-update"'
    );
    expect(markup).toContain("Install latest update");
    expect(markup).toContain("text-text-2");
    expect(markup).not.toContain("group-hover:text-warning-6");
    expect(markup).toContain("gap-2");
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("p-2");
    expect(markup).toContain("bg-warning-6/5");
    expect(markup).toContain("@[800px]/startactions:grid-cols-3");

    const updateIndex = markup.indexOf(
      'data-testid="chat-panel-start-page-install-latest-update"'
    );
    const importSessionIndex = markup.indexOf(
      'data-testid="chat-panel-start-page-import-session"'
    );
    const addApiKeyIndex = markup.indexOf(
      'data-testid="chat-panel-start-page-add-api-key"'
    );

    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(importSessionIndex).toBeGreaterThan(updateIndex);
    expect(addApiKeyIndex).toBeGreaterThan(importSessionIndex);
    expect(markup).not.toContain(
      'data-testid="chat-panel-start-page-new-work-item"'
    );
  });

  it("hides the install action when no update has been detected", () => {
    mocks.useAvailableAppUpdate.mockReturnValue(null);
    const t = ((key: string) => key) as TFunction<
      ["sessions", "common", "projects", "navigation"]
    >;

    const markup = renderToStaticMarkup(
      createElement(ChatPanelStartPage, {
        initialView: "more",
        onAddApiKey: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        t,
      })
    );

    expect(markup).not.toContain(
      'data-testid="chat-panel-start-page-install-latest-update"'
    );
  });

  it("renders import session before add API key in More", () => {
    mocks.useAvailableAppUpdate.mockReturnValue(null);
    const t = ((key: string) => key) as TFunction<
      ["sessions", "common", "projects", "navigation"]
    >;

    const markup = renderToStaticMarkup(
      createElement(ChatPanelStartPage, {
        initialView: "more",
        onAddApiKey: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        t,
      })
    );

    const importSessionIndex = markup.indexOf(
      'data-testid="chat-panel-start-page-import-session"'
    );
    const addApiKeyIndex = markup.indexOf(
      'data-testid="chat-panel-start-page-add-api-key"'
    );

    expect(importSessionIndex).toBeGreaterThanOrEqual(0);
    expect(addApiKeyIndex).toBeGreaterThan(importSessionIndex);
    expect(markup).toContain("navigation:cloud.share.importEntry");
    expect(markup.match(/border-border-2/g)).toHaveLength(2);
    expect(markup.match(/hover:border-border-3/g)).toHaveLength(2);
    expect(markup).not.toContain("group-hover:bg-fill-3");
  });

  it("renders the full work-item creator inside the Work Item tab", () => {
    mocks.useAvailableAppUpdate.mockReturnValue(null);
    const t = ((key: string) => key) as TFunction<
      ["sessions", "common", "projects", "navigation"]
    >;

    const markup = renderToStaticMarkup(
      createElement(ChatPanelStartPage, {
        initialView: "work-item",
        onAddApiKey: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        t,
        workItemLauncher: createElement(
          "div",
          { "data-testid": "full-work-item-creator" },
          "Full work item creator"
        ),
      })
    );

    expect(markup).toContain(
      'data-testid="chat-panel-start-page-work-item-launcher"'
    );
    expect(markup).toContain('data-testid="full-work-item-creator"');
    expect(markup).toContain("Full work item creator");
    expect(markup).not.toContain(
      'data-testid="chat-panel-start-page-new-work-item"'
    );
  });

  it("centers the Session, Work Item, and More tabs above the launcher", () => {
    mocks.useAvailableAppUpdate.mockReturnValue(null);
    const t = ((key: string) => key) as TFunction<
      ["sessions", "common", "projects", "navigation"]
    >;

    const markup = renderToStaticMarkup(
      createElement(ChatPanelStartPage, {
        onAddApiKey: vi.fn(),
        onInstallLatestUpdate: vi.fn(),
        sessionLauncher: createElement("div", null, "Session launcher"),
        t,
      })
    );

    expect(markup).toContain(
      'data-testid="chat-panel-start-page-session-launcher"'
    );
    expect(markup).toContain('data-testid="chat-panel-start-page-tabs"');
    expect(markup).toContain('data-testid="chat-panel-start-page-tab-session"');
    expect(markup).toContain(
      'data-testid="chat-panel-start-page-tab-work-item"'
    );
    expect(markup).toContain('data-testid="chat-panel-start-page-tab-more"');
    expect(markup).toContain("chat.startPage.tabs.session");
    expect(markup).toContain("chat.startPage.tabs.workItem");
    expect(markup).toContain("chat.startPage.tabs.more");
    expect(markup).not.toContain("chat.startPage.tabs.manage");
    expect(markup).not.toContain("chat.startPage.tabs.runtime");
    expect(markup).toContain('data-testid="chat-panel-start-page-hints"');
    expect(markup).not.toContain('data-testid="chat-panel-start-page-actions"');
    expect(markup).toContain("Session launcher");
    expect(markup).not.toContain(
      'data-testid="chat-panel-start-page-new-session"'
    );
  });
});
