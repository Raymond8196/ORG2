import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Button from ".";

function renderSplitDropdownClassName(
  variant:
    | "primary"
    | "secondary"
    | "danger"
    | "warning"
    | "success"
    | "merged",
  dropdownVisible = false
): string {
  const markup = renderToStaticMarkup(
    React.createElement(
      Button,
      {
        variant,
        dropdownMenu: React.createElement("div"),
        onDropdownClick: vi.fn(),
        dropdownVisible,
      },
      "Action"
    )
  );
  const buttonClassNames = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)];
  return buttonClassNames.at(-1)?.[1] ?? "";
}

describe("Button split dropdown segment", () => {
  it("uses the success tone while hovered or open", () => {
    expect(renderSplitDropdownClassName("success")).toContain(
      "enabled:hover:bg-success-5"
    );
    expect(renderSplitDropdownClassName("success", true)).toContain(
      "bg-success-5 enabled:hover:bg-success-5"
    );
  });

  it("uses GitHub purple for the merged variant and its split state", () => {
    expect(renderSplitDropdownClassName("merged")).toContain(
      "enabled:hover:bg-purple-5"
    );
    expect(renderSplitDropdownClassName("merged", true)).toContain(
      "bg-purple-5 enabled:hover:bg-purple-5"
    );
    expect(
      renderToStaticMarkup(
        React.createElement(Button, { variant: "merged" }, "Merged")
      )
    ).toContain("bg-purple-6");
  });

  it.each([
    ["primary", "primary"],
    ["danger", "danger"],
    ["warning", "warning"],
  ] as const)("uses the %s tone for its semantic variant", (variant, tone) => {
    expect(renderSplitDropdownClassName(variant)).toContain(
      `enabled:hover:bg-${tone}-5`
    );
  });

  it("keeps neutral solid split buttons neutral", () => {
    expect(renderSplitDropdownClassName("secondary")).toContain(
      "enabled:hover:bg-fill-3"
    );
  });
});
