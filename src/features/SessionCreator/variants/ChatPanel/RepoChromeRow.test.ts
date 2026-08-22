// @vitest-environment jsdom
import { type ComponentProps, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { popupNativeMenu } from "@src/util/platform/tauri/nativeMenuPopup";

import RepoChromeRow from "./RepoChromeRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key.endsWith(".up") ? "Up" : "Down"),
  }),
}));

vi.mock("@src/util/platform/tauri/nativeMenuPopup", () => ({
  popupNativeMenu: vi.fn().mockResolvedValue({ status: "closed" }),
}));

const mockedPopupNativeMenu = vi.mocked(popupNativeMenu);
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("RepoChromeRow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockedPopupNativeMenu.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("replaces the WebView menu with native checked Up/Down actions", async () => {
    const onPositionChange = vi.fn();
    act(() => {
      root.render(
        createElement(
          RepoChromeRow,
          {
            position: "top",
            onPositionChange,
          } as unknown as ComponentProps<typeof RepoChromeRow>,
          createElement("span", null, "repository chrome")
        )
      );
    });

    const row = container.querySelector<HTMLElement>(
      '[data-testid="session-creator-repo-chrome"]'
    );
    expect(row).not.toBeNull();

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => row?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(mockedPopupNativeMenu).toHaveBeenCalledOnce();
    const popupOptions = mockedPopupNativeMenu.mock.calls[0]?.[0];
    expect(popupOptions?.source).toBe("session-creator-repo-chrome");

    const items = await popupOptions?.buildItems();
    const upItem = items?.[0] as
      | { checked?: boolean; action?: () => void }
      | undefined;
    const downItem = items?.[1] as
      | { checked?: boolean; action?: () => void }
      | undefined;
    expect(upItem?.checked).toBe(true);
    expect(downItem?.checked).toBe(false);

    act(() => downItem?.action?.());
    expect(onPositionChange).toHaveBeenCalledWith("bottom");
  });
});
