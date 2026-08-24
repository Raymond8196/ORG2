import { readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetRendererComponentCache,
  getRendererLazyComponent,
  invalidateRendererComponents,
} from "./rendererComponents";

afterEach(() => {
  __resetRendererComponentCache();
});

describe("renderer lazy cache", () => {
  const load = vi.fn(async () => ({ default: () => null }));

  it("returns a stable component during ordinary renders", () => {
    const first = getRendererLazyComponent("file", "inner", load);
    const second = getRendererLazyComponent("file", "inner", load);

    expect(second).toBe(first);
  });

  it("rebuilds both outer and inner lazy objects after a scoped retry", () => {
    const outer = getRendererLazyComponent("file", "outer", load);
    const inner = getRendererLazyComponent("file", "inner", load);

    invalidateRendererComponents("file");

    expect(getRendererLazyComponent("file", "outer", load)).not.toBe(outer);
    expect(getRendererLazyComponent("file", "inner", load)).not.toBe(inner);
  });

  it("does not evict a different tab type", () => {
    const directory = getRendererLazyComponent("directory", "inner", load);
    getRendererLazyComponent("file", "inner", load);

    invalidateRendererComponents("file");

    expect(getRendererLazyComponent("directory", "inner", load)).toBe(
      directory
    );
  });
});

describe("direct inner renderer boundaries", () => {
  const rendererFiles = [
    "file.tsx",
    "directory.tsx",
    "gitDiff.tsx",
    "gitStashDetail.tsx",
    "gitLog.tsx",
    "search.tsx",
    "terminal.tsx",
    "gitCommitDetail.tsx",
    "terminalContent.tsx",
  ];

  it.each(rendererFiles)("%s participates in scoped invalidation", (file) => {
    const source = readFileSync(
      path.resolve(__dirname, "renderers", file),
      "utf8"
    );
    expect(source).toContain("getRendererLazyComponent");
    expect(source).not.toContain("React.lazy(");
  });
});
