// @vitest-environment jsdom
// The project test glob intentionally uses `.test.ts`; JSX is built with createElement.
import type { Editor } from "@tiptap/react";
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
  vi,
} from "vitest";

import { FloatingToolbar } from "./FloatingToolbar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("FloatingToolbar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

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

  it("renders the formatting controls inline without a floating position", () => {
    const editor = {
      isActive: vi.fn(() => false),
    } as unknown as Editor;

    act(() => {
      root.render(
        createElement(FloatingToolbar, {
          editor,
          placement: "inline",
        })
      );
    });

    const toolbar = container.querySelector<HTMLElement>("[role='toolbar']");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.classList.contains("rich-text-editor-toolbar-inline")).toBe(
      true
    );
    expect(toolbar?.style.position).toBe("");
    expect(
      toolbar?.querySelector("[aria-label='creator.toolbar.bold']")
    ).not.toBeNull();
  });
});
