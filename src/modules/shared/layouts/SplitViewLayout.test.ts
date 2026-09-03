import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SplitViewLayout from "./SplitViewLayout";

describe("SplitViewLayout", () => {
  it("shows the existing list panel full width without adding a list header", () => {
    const markup = renderToStaticMarkup(
      createElement(SplitViewLayout, {
        listContent: createElement("div", null, "List content"),
        mainContent: createElement("div", null, "Detail content"),
        listFullscreen: true,
      })
    );

    expect(markup).toContain("List content");
    expect(markup).not.toContain("Detail content");
    expect(markup).not.toContain("h-[40px]");
  });
});
