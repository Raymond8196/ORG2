import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DetailTabStrip from "./DetailTabStrip";

describe("DetailTabStrip", () => {
  it("links tabs to their panels and renders optional counts", () => {
    const markup = renderToStaticMarkup(
      createElement(DetailTabStrip, {
        activeTab: "list",
        ariaLabel: "Project views",
        idPrefix: "project-detail",
        onChange: vi.fn(),
        tabs: [
          { key: "overview", label: "Overview" },
          { key: "list", label: "List", count: 3 },
        ],
      })
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Project views"');
    expect(markup).toContain('id="project-detail-tab-list"');
    expect(markup).toContain('aria-controls="project-detail-tabpanel-list"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(">3</span>");
    expect(markup).toMatch(/role="tablist"[^>]*border-b/);
    expect(markup).toMatch(
      /aria-selected="true"[^>]*after:-bottom-px[^>]*after:bg-bg-2/
    );
    expect(markup).not.toContain("overflow-y-hidden");
  });

  it("keeps host controls in a trailing slot", () => {
    const markup = renderToStaticMarkup(
      createElement(DetailTabStrip, {
        activeTab: "overview",
        ariaLabel: "Project views",
        idPrefix: "project-detail",
        onChange: vi.fn(),
        tabs: [{ key: "overview", label: "Overview" }],
        trailing: createElement("button", { type: "button" }, "Filter"),
      })
    );

    expect(markup).toContain(">Filter</button>");
  });
});
