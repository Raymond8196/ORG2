// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatPanelStartPage } from "./ChatPanelStartPage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
        onNewWorkItem: vi.fn(),
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
        onNewWorkItem: vi.fn(),
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
        onNewWorkItem: vi.fn(),
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

  it("opens the existing work-item creator from the Work Item tab", () => {
    mocks.useAvailableAppUpdate.mockReturnValue(null);
    const t = ((key: string) => key) as TFunction<
      ["sessions", "common", "projects", "navigation"]
    >;

    const onNewWorkItem = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(ChatPanelStartPage, {
          onAddApiKey: vi.fn(),
          onInstallLatestUpdate: vi.fn(),
          onNewWorkItem,
          t,
        })
      );
    });

    const workItemTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-panel-start-page-tab-work-item"]'
    );
    expect(workItemTab).not.toBeNull();

    act(() => {
      workItemTab?.click();
    });

    expect(onNewWorkItem).toHaveBeenCalledOnce();
    expect(
      container.querySelector(
        '[data-testid="chat-panel-start-page-new-work-item"]'
      )
    ).toBeNull();

    act(() => {
      root.unmount();
    });
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
        onNewWorkItem: vi.fn(),
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
