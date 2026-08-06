// @vitest-environment jsdom
import { type RefObject, act, createElement, createRef } from "react";
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

import { useCanvasDesignInspector } from "./useCanvasDesignInspector";

const resizeObserverObserve = vi.fn();
const resizeObserverDisconnect = vi.fn();

class ResizeObserverStub {
  observe = resizeObserverObserve;
  disconnect = resizeObserverDisconnect;
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("useCanvasDesignInspector", () => {
  let container: HTMLDivElement;
  let root: Root;
  let inspectorRootRef: RefObject<HTMLDivElement | null>;
  const onCanvasAction = vi.fn();
  const onRequestDisable = vi.fn();
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    inspectorRootRef = createRef<HTMLDivElement>();
    onCanvasAction.mockReset();
    onRequestDisable.mockReset();
    resizeObserverObserve.mockReset();
    resizeObserverDisconnect.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function Harness({ enabled = true }: { enabled?: boolean }) {
    const inspector = useCanvasDesignInspector(
      inspectorRootRef,
      enabled,
      onRequestDisable
    );
    return createElement(
      "div",
      { ref: inspectorRootRef, "data-testid": "root" },
      createElement(
        "button",
        {
          type: "button",
          "data-component": "Stat",
          "data-testid": "target",
          onClick: onCanvasAction,
        },
        "M"
      ),
      createElement(
        "output",
        { "data-testid": "selection" },
        inspector.selected
          ? `${inspector.selected.kind}:${inspector.selected.label}`
          : "none"
      ),
      createElement(
        "output",
        { "data-testid": "hover" },
        inspector.hovered
          ? `${inspector.hovered.kind}:${inspector.hovered.label}`
          : "none"
      )
    );
  }

  function mountHarness(enabled = true) {
    act(() => root.render(createElement(Harness, { enabled })));
    const inspectRoot = container.querySelector<HTMLElement>(
      "[data-testid='root']"
    )!;
    const target = container.querySelector<HTMLButtonElement>(
      "[data-testid='target']"
    )!;
    vi.spyOn(inspectRoot, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 500, 400)
    );
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
      rect(40, 60, 120, 80)
    );
    return { inspectRoot, target };
  }

  it("selects an element without activating the Canvas control underneath", () => {
    const { target } = mountHarness();

    act(() => {
      target.dispatchEvent(pointerEvent("pointerdown", 50, 70));
      target.dispatchEvent(pointerEvent("pointerup", 50, 70));
      target.click();
    });

    expect(
      container.querySelector("[data-testid='selection']")?.textContent
    ).toBe("element:Stat");
    expect(onCanvasAction).not.toHaveBeenCalled();
  });

  it("keeps hover visible until a window-level pointerup commits selection", () => {
    const { inspectRoot, target } = mountHarness();
    const unavailablePointerCapture = vi.fn(() => {
      throw new DOMException("Pointer capture unavailable");
    });
    Object.defineProperty(inspectRoot, "setPointerCapture", {
      configurable: true,
      value: unavailablePointerCapture,
    });

    act(() => target.dispatchEvent(pointerEvent("pointermove", 50, 70)));
    expect(container.querySelector("[data-testid='hover']")?.textContent).toBe(
      "element:Stat"
    );

    act(() => target.dispatchEvent(pointerEvent("pointerdown", 50, 70)));
    expect(container.querySelector("[data-testid='hover']")?.textContent).toBe(
      "element:Stat"
    );

    act(() => window.dispatchEvent(pointerEvent("pointerup", 50, 70)));
    expect(
      container.querySelector("[data-testid='selection']")?.textContent
    ).toBe("element:Stat");
    expect(unavailablePointerCapture).not.toHaveBeenCalled();
  });

  it("turns a drag gesture into a bounded region selection", () => {
    const { target } = mountHarness();

    act(() => {
      target.dispatchEvent(pointerEvent("pointerdown", 45, 65));
      target.dispatchEvent(pointerEvent("pointermove", 150, 130));
      target.dispatchEvent(pointerEvent("pointerup", 150, 130));
    });

    expect(
      container.querySelector("[data-testid='selection']")?.textContent
    ).toBe("region:Stat");
  });

  it("clears selection on the first Escape and exits on the second", () => {
    const { target } = mountHarness();
    act(() => {
      target.dispatchEvent(pointerEvent("pointerdown", 50, 70));
      target.dispatchEvent(pointerEvent("pointerup", 50, 70));
    });

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(
      container.querySelector("[data-testid='selection']")?.textContent
    ).toBe("none");
    expect(onRequestDisable).not.toHaveBeenCalled();

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(onRequestDisable).toHaveBeenCalledTimes(1);
  });

  it("owns listeners only while Design mode is enabled", () => {
    const { inspectRoot } = mountHarness(false);
    const addListener = vi.spyOn(inspectRoot, "addEventListener");
    const removeListener = vi.spyOn(inspectRoot, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");

    act(() => root.render(createElement(Harness, { enabled: true })));
    expect(addListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      true
    );
    expect(addListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true
    );
    act(() =>
      inspectRoot.dispatchEvent(new Event("scroll", { bubbles: true }))
    );

    act(() => root.render(createElement(Harness, { enabled: false })));
    expect(removeListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      true
    );
    expect(removeListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function)
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true
    );
    expect(resizeObserverDisconnect).toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
