import { describe, expect, it } from "vitest";

import { toTimelineRepoRelativePath } from "./filePath";

describe("toTimelineRepoRelativePath", () => {
  it("strips a Windows repo root and normalizes separators", () => {
    expect(
      toTimelineRepoRelativePath(
        "C:\\Projects\\ORGII\\src\\package.json",
        "\\\\?\\C:\\Projects\\ORGII",
        "C:\\Projects\\ORGII"
      )
    ).toBe("src/package.json");
  });

  it("strips a POSIX repo root", () => {
    expect(
      toTimelineRepoRelativePath(
        "/Users/vince/ORGII/src/package.json",
        "/Users/vince/ORGII",
        "/Users/vince/ORGII"
      )
    ).toBe("src/package.json");
  });

  it("keeps an unmatched path for backend resolution", () => {
    expect(
      toTimelineRepoRelativePath(
        "D:\\other\\package.json",
        "C:\\Projects\\ORGII",
        "C:\\Projects\\ORGII"
      )
    ).toBe("D:\\other\\package.json");
  });

  it("returns null without a selected file or repository", () => {
    expect(toTimelineRepoRelativePath(null, "repo", "repo")).toBeNull();
    expect(toTimelineRepoRelativePath("file.ts", null, null)).toBeNull();
  });
});
