import { describe, expect, it } from "vitest";

import { resolveWorkItemThreadHeaderPolicy } from "../presentation";
import { WORK_ITEM_THREAD_TOKENS } from "../tokens";

describe("resolveWorkItemThreadHeaderPolicy", () => {
  it("omits the metadata band when no path or properties exist", () => {
    expect(resolveWorkItemThreadHeaderPolicy(false, false)).toEqual({
      showHeader: false,
      showSeparator: false,
    });
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    "renders a single header source without a separator",
    (hasPath, hasProperties) => {
      expect(resolveWorkItemThreadHeaderPolicy(hasPath, hasProperties)).toEqual(
        {
          showHeader: true,
          showSeparator: false,
        }
      );
    }
  );

  it("separates the path from properties when both are present", () => {
    expect(resolveWorkItemThreadHeaderPolicy(true, true)).toEqual({
      showHeader: true,
      showSeparator: true,
    });
  });
});

describe("work item thread metadata presentation", () => {
  it("uses an unframed control row without vertical padding", () => {
    const classNames = WORK_ITEM_THREAD_TOKENS.metadataBand.split(" ");

    expect(classNames).toContain("overflow-x-auto");
    expect(classNames.some((className) => className.startsWith("px-"))).toBe(
      false
    );
    expect(classNames.some((className) => className.startsWith("py-"))).toBe(
      false
    );
    expect(classNames.some((className) => className.startsWith("bg-"))).toBe(
      false
    );
    expect(classNames.some((className) => className.startsWith("border"))).toBe(
      false
    );
    expect(
      classNames.some((className) => className.startsWith("rounded"))
    ).toBe(false);
  });
});
