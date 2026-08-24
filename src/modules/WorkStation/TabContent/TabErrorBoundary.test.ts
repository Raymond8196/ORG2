import { describe, expect, it, vi } from "vitest";

import { TabErrorBoundary } from "./TabErrorBoundary";

describe("TabErrorBoundary tab isolation", () => {
  const props = {
    tabId: "file-a",
    tabType: "file" as const,
    onRetry: vi.fn(),
    children: null,
  };

  it("clears only its error state when the active tab id changes", () => {
    const error = new Error("file A failed");

    expect(
      TabErrorBoundary.getDerivedStateFromProps(
        { ...props, tabId: "file-b" },
        { error, tabId: "file-a" }
      )
    ).toEqual({ error: null, tabId: "file-b" });
  });

  it("preserves the error while the same tab remains active", () => {
    expect(
      TabErrorBoundary.getDerivedStateFromProps(props, {
        error: new Error("still failed"),
        tabId: "file-a",
      })
    ).toBeNull();
  });
});
