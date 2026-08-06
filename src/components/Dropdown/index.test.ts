import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Dropdown from ".";

describe("Dropdown", () => {
  it("right-aligns the menu by default", () => {
    const props: React.ComponentProps<typeof Dropdown> = {
      defaultPopupVisible: true,
      droplist: React.createElement("div", null, "Menu"),
      children: React.createElement("button", { type: "button" }, "Open"),
    };
    const markup = renderToStaticMarkup(React.createElement(Dropdown, props));

    expect(markup).toContain("top-full right-0 mt-2");
    expect(markup).not.toContain("top-full left-0 mt-2");
  });
});
