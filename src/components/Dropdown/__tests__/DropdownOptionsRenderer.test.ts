// @vitest-environment jsdom
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

import DropdownOptionsRenderer from "../DropdownOptionsRenderer";
import { DROPDOWN_PANEL } from "../tokens";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("DropdownOptionsRenderer auto-hiding scrollbar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  const renderOptions = async () => {
    await act(async () => {
      root.render(
        React.createElement(DropdownOptionsRenderer, {
          options: [
            { label: "Blue", value: "blue" },
            { label: "Purple", value: "purple" },
          ],
          value: "blue",
          mode: "single",
          highlightedIndex: 0,
          keyboardNavigated: false,
          onSelect: vi.fn(),
        })
      );
    });

    return container.querySelector<HTMLDivElement>(
      ".dropdown-options-scrollbar"
    );
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("reveals the thumb during scroll and hides it after the quiet period", async () => {
    const scrollContainer = await renderOptions();

    expect(scrollContainer).not.toBeNull();
    expect(
      scrollContainer?.classList.contains("dropdown-options-scrollbar--active")
    ).toBe(false);

    act(() => {
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
    expect(
      scrollContainer?.classList.contains("dropdown-options-scrollbar--active")
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(DROPDOWN_PANEL.scrollbarHideDelayMs - 1);
    });
    expect(
      scrollContainer?.classList.contains("dropdown-options-scrollbar--active")
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      scrollContainer?.classList.contains("dropdown-options-scrollbar--active")
    ).toBe(false);
  });

  it("restarts the hide delay on continued scrolling", async () => {
    const scrollContainer = await renderOptions();

    act(() => {
      scrollContainer?.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(DROPDOWN_PANEL.scrollbarHideDelayMs / 2);
      scrollContainer?.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(DROPDOWN_PANEL.scrollbarHideDelayMs - 1);
    });

    expect(
      scrollContainer?.classList.contains("dropdown-options-scrollbar--active")
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      scrollContainer?.classList.contains("dropdown-options-scrollbar--active")
    ).toBe(false);
  });
});
