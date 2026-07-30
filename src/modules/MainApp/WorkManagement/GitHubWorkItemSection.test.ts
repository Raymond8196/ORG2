// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { GitHubWorkItemSection } from "./GitHubWorkItemList";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("GitHubWorkItemSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("collapses and expands its pull-request rows from the section header", () => {
    act(() => {
      root.render(
        createElement(
          GitHubWorkItemSection,
          {
            label: "Authored by me",
            testId: "github-pr-authored",
          },
          createElement("div", { "data-testid": "pr-row" }, "Pull request")
        )
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="github-pr-authored-toggle"]'
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="pr-row"]')).not.toBeNull();

    act(() => toggle?.click());

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="pr-row"]')).toBeNull();
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();
  });
});
