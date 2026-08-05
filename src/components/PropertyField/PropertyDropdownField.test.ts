import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PropertyDropdownField } from "./PropertyDropdownField";

describe("PropertyDropdownField", () => {
  it("does not build custom options while the dropdown is closed", () => {
    const renderOptions = vi.fn(() =>
      React.createElement("span", null, "Option")
    );

    renderToStaticMarkup(
      React.createElement(PropertyDropdownField, {
        value: "open",
        label: "Open",
        icon: null,
        active: false,
        renderOptions,
      })
    );

    expect(renderOptions).not.toHaveBeenCalled();
  });
});
