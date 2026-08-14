// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import ReactArtifactRunner from "./ReactArtifactRunner";

describe("ReactArtifactRunner runtime", () => {
  it("renders stateful generated sketches and keeps controls interactive", async () => {
    const root = createSmokeRoot();
    const onError = vi.fn();
    const source = `
      const { useState } = React;
      function App() {
        const [count, setCount] = useState(0);
        return React.createElement(
          "button",
          {
            type: "button",
            style: { background: "rgb(86, 109, 232)", color: "white" },
            onClick: () => setCount((value) => value + 1)
          },
          "Count " + count
        );
      }
    `;

    try {
      await root.render(
        React.createElement(ReactArtifactRunner, { source, onError })
      );

      const button = root.container.querySelector("button");
      expect(button?.textContent).toBe("Count 0");
      expect(button?.style.background).toBe("rgb(86, 109, 232)");

      await dispatch(() => button?.click());

      expect(button?.textContent).toBe("Count 1");
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await root.unmount();
    }
  });

  it("keeps tall and fixed-width sketches reachable inside the bounded scroll container", async () => {
    const root = createSmokeRoot();
    const source = `
      function App() {
        return React.createElement(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "220px 330px minmax(450px, 1fr)",
              height: 1200,
              overflow: "hidden"
            }
          },
          "Tall and wide sketch"
        );
      }
    `;

    try {
      await root.render(React.createElement(ReactArtifactRunner, { source }));

      const scrollContainer = root.container.querySelector(
        '[data-testid="react-artifact-scroll"]'
      );
      const preview = root.container.querySelector(
        '[data-testid="react-artifact-preview"]'
      );
      expect(scrollContainer?.classList.contains("overflow-auto")).toBe(true);
      expect(preview?.classList.contains("w-fit")).toBe(true);
      expect(preview?.classList.contains("min-w-full")).toBe(true);
    } finally {
      await root.unmount();
    }
  });

  it("surfaces compile failures as a visible banner and forwards onError", async () => {
    const root = createSmokeRoot();
    const onError = vi.fn();
    // Unbalanced parenthesis — react-live's transpile step must throw.
    const source = `function App( { return null; }`;

    try {
      await root.render(
        React.createElement(ReactArtifactRunner, { source, onError })
      );

      const banner = root.container.querySelector(
        '[data-testid="react-artifact-error"]'
      );
      expect(banner).not.toBeNull();
      expect(banner?.textContent?.trim().length).toBeGreaterThan(0);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
      );
    } finally {
      await root.unmount();
    }
  });

  it("renders a visible localized notice instead of a blank card when eval is blocked", async () => {
    const root = createSmokeRoot();
    const onError = vi.fn();
    const source = `
      function App() {
        return React.createElement("button", null, "Never runs");
      }
    `;

    try {
      await root.render(
        React.createElement(ReactArtifactRunner, {
          source,
          onError,
          evalAvailable: false,
        })
      );

      const notice = root.container.querySelector(
        '[data-testid="react-artifact-csp-notice"]'
      );
      expect(notice).not.toBeNull();
      expect(notice?.textContent?.trim().length).toBeGreaterThan(0);
      // The artifact itself must not execute in the host document.
      expect(root.container.querySelector("button")).toBeNull();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
      );

      // A parent-only rerender keeps the notice stable (no crash, no blank).
      await root.render(
        React.createElement(ReactArtifactRunner, {
          source,
          onError,
          evalAvailable: false,
        })
      );
      expect(
        root.container.querySelector(
          '[data-testid="react-artifact-csp-notice"]'
        )
      ).not.toBeNull();
    } finally {
      await root.unmount();
    }
  });

  it("keeps the live preview DOM and its state across parent rerenders", async () => {
    const root = createSmokeRoot();
    const source = `
      const { useState } = React;
      function App() {
        const [count, setCount] = useState(0);
        return React.createElement(
          "button",
          { type: "button", onClick: () => setCount((value) => value + 1) },
          "Count " + count
        );
      }
    `;

    try {
      await root.render(
        React.createElement(ReactArtifactRunner, {
          source,
          onError: vi.fn(),
        })
      );
      const originalButton = root.container.querySelector("button");
      await dispatch(() => originalButton?.click());
      expect(originalButton?.textContent).toBe("Count 1");

      await root.render(
        React.createElement(ReactArtifactRunner, {
          source,
          onError: vi.fn(),
        })
      );

      const buttonAfterParentRender = root.container.querySelector("button");
      expect(buttonAfterParentRender).toBe(originalButton);
      expect(buttonAfterParentRender?.textContent).toBe("Count 1");
    } finally {
      await root.unmount();
    }
  });
});
