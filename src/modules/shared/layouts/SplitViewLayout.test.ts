import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SplitViewLayout from "./SplitViewLayout";

describe("SplitViewLayout", () => {
  it("keeps the shared list header with the split content", () => {
    const markup = renderToStaticMarkup(
      createElement(SplitViewLayout, {
        listHeader: createElement("header", null, "List header"),
        listContent: createElement("div", null, "List content"),
        mainContent: createElement("div", null, "Detail content"),
        listWidth: 240,
      })
    );

    expect(markup).toContain("List header");
    expect(markup).toContain("List content");
    expect(markup).toContain("Detail content");
  });
});
