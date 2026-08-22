// @vitest-environment jsdom
import { type ComponentProps, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Tooltip from ".";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Tooltip child refs", () => {
  it("hands changing callback refs to React without render-driven state churn", () => {
    const firstRef = vi.fn();
    const secondRef = vi.fn();
    const render = (childRef: (node: HTMLButtonElement | null) => void) =>
      createElement(
        Tooltip,
        { content: "Details" } as ComponentProps<typeof Tooltip>,
        createElement("button", { ref: childRef }, "Trigger")
      );

    act(() => root.render(render(firstRef)));
    const button = container.querySelector("button");
    expect(firstRef).toHaveBeenLastCalledWith(button);

    act(() => root.render(render(secondRef)));
    expect(firstRef).toHaveBeenLastCalledWith(null);
    expect(secondRef).toHaveBeenLastCalledWith(button);

    for (let index = 0; index < 20; index += 1) {
      act(() => root.render(render(vi.fn())));
    }
    expect(container.querySelector("button")).toBe(button);
  });
});
