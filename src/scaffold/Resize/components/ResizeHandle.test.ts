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

import { ResizeHandle } from "./ResizeHandle";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("ResizeHandle indicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    container.style.overflow = "hidden";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps the bright segment attached to the actual divider line", () => {
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          indicatorPlacement: "start",
          onMouseDown: () => undefined,
        })
      );
    });

    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    expect(handle).not.toBeNull();

    const indicator = handle!.querySelector<HTMLElement>(
      "[data-resize-handle-indicator]"
    );
    expect(indicator).not.toBeNull();
    expect(handle!.contains(indicator)).toBe(true);
    expect(indicator?.className).toContain("absolute");
    expect(indicator?.className).toContain("w-[4px]");
    expect(indicator?.className).toContain("right-0");
    expect(indicator?.className).not.toContain("fixed");
  });

  it("shows the contextual shortcut only after one second of hover", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          onMouseDown: () => undefined,
          tooltipLabel: "Hide Sidebar",
          tooltipShortcut: "Cmd+B",
        })
      );
    });

    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    expect(handle).not.toBeNull();

    act(() => {
      handle!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(999);
    });
    expect(document.body.textContent).not.toContain("Hide Sidebar");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      document.body.querySelector(".native-tooltip-content-inner")?.textContent
    ).toContain("Hide Sidebar");
  });
});
