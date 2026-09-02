// @vitest-environment jsdom
import { Provider } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ContextMenu from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("./contextMenuSearchHandlers", () => ({
  searchFiles: vi.fn(async () => []),
  searchProjects: vi.fn(async () => []),
  searchSessions: vi.fn(() => []),
}));

describe("ContextMenu shared + / @ contract", () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previousActEnvironment: boolean | undefined;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("uses the composer query and arrow/enter mode navigation", async () => {
    const onModeSelect = vi.fn();

    const renderMenu = (searchQuery: string) =>
      React.createElement(
        Provider,
        null,
        React.createElement(ContextMenu, {
          visible: true,
          onClose: vi.fn(),
          onSelect: vi.fn(),
          onImageUpload: vi.fn(),
          currentMode: "build",
          onModeSelect,
          searchQuery,
        })
      );

    await act(async () => {
      root.render(renderMenu(""));
    });

    expect(
      container.querySelector('[data-testid="context-menu-search-input"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="context-menu-image-upload"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="context-menu-mode-option-build"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="context-menu-mode-option-plan"]')
    ).not.toBeNull();

    const menu = container.querySelector<HTMLElement>(".context-menu");
    act(() => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        })
      );
    });
    act(() => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        })
      );
    });
    act(() => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(onModeSelect).toHaveBeenCalledWith("plan");

    await act(async () => {
      root.render(renderMenu("ask"));
    });
    expect(
      container.querySelector('[data-testid="context-menu-mode-option-build"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="context-menu-mode-option-ask"]')
    ).not.toBeNull();
  });
});
