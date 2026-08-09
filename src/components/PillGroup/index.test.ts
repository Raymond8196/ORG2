import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PillGroup, { type PillGroupSegment } from ".";

function renderGhostSegment(active = false): string {
  const segments: PillGroupSegment[] = [
    {
      id: "repo",
      icon: null,
      label: "ORGII",
      active,
    },
  ];

  return renderToStaticMarkup(
    createElement(PillGroup, { segments, variant: "ghost" })
  );
}

describe("PillGroup", () => {
  it("gives ghost segments a hover surface", () => {
    expect(renderGhostSegment()).toContain("enabled:hover:!bg-fill-3");
  });

  it("keeps the surface while a ghost segment is active", () => {
    expect(renderGhostSegment(true)).toContain("!bg-fill-3");
  });

  it("uses a higher-contrast surface when requested", () => {
    const segments: PillGroupSegment[] = [
      { id: "location", icon: null, label: "Local" },
    ];
    const markup = renderToStaticMarkup(
      createElement(PillGroup, { segments, strongSurface: true })
    );

    expect(markup).toContain("enabled:hover:!bg-fill-3");
  });

  it("keeps the higher-contrast surface while open", () => {
    const segments: PillGroupSegment[] = [
      { id: "branch", icon: null, label: "develop", active: true },
    ];
    const markup = renderToStaticMarkup(
      createElement(PillGroup, { segments, strongSurface: true })
    );

    expect(markup).toContain("!bg-fill-3");
  });
});
