import { RefreshCw } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { REFRESH_ICON_TOKENS } from "@src/components/RefreshIcon/tokens";

import type { NavigationMenuItem } from "../config";
import {
  NavigationMenuLeafRow,
  NavigationMenuParentRow,
} from "./NavigationMenuRow";

const baseItem: NavigationMenuItem = {
  id: "sidebar-row",
  key: "sidebar-row",
  label: "Sidebar row",
};

describe("NavigationMenuRow", () => {
  it("uses one fixed 32px height for parent and leaf rows", () => {
    const parentMarkup = renderToStaticMarkup(
      createElement(NavigationMenuParentRow, {
        item: {
          ...baseItem,
          children: [{ ...baseItem, id: "child", key: "child" }],
        },
        isChild: false,
        isOpen: false,
        submenuSelected: false,
        collapsed: false,
        t: (key: string) => key,
        renderIcon: () => null,
        renderMenuItem: () => createElement("div"),
        onRowMouseEnter: vi.fn(),
        onRowActionClick: vi.fn(),
        onToggleSubmenu: vi.fn(),
      })
    );
    const leafMarkup = renderToStaticMarkup(
      createElement(NavigationMenuLeafRow, {
        item: baseItem,
        isChild: false,
        isSelected: false,
        collapsed: false,
        t: (key: string) => key,
        renderIcon: () => null,
        onMenuItemClick: vi.fn(),
        onRowMouseEnter: vi.fn(),
        onRowActionClick: vi.fn(),
      })
    );

    for (const markup of [parentMarkup, leafMarkup]) {
      expect(markup).toContain("flex h-8 items-center");
      expect(markup).not.toContain("min-h-[36px]");
    }
  });

  it("forwards the shared refresh animation class to row-action icons", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationMenuLeafRow, {
        item: {
          ...baseItem,
          showMoreActions: true,
          rowActions: [
            {
              icon: RefreshCw,
              iconClassName: REFRESH_ICON_TOKENS.oneShot,
              label: "Refresh",
              onClick: vi.fn(),
            },
          ],
        },
        isChild: false,
        isSelected: false,
        collapsed: false,
        t: (key: string) => key,
        renderIcon: () => null,
        onMenuItemClick: vi.fn(),
        onRowMouseEnter: vi.fn(),
        onRowActionClick: vi.fn(),
      })
    );

    expect(markup).toContain(
      `lucide-refresh-cw ${REFRESH_ICON_TOKENS.oneShot}`
    );
  });

  it("swaps the accessory slot instantly, with no reveal animation", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationMenuLeafRow, {
        item: {
          ...baseItem,
          shortcut: "21h",
          showMoreActions: true,
          trailingElement: createElement("span", null, "dot"),
        },
        isChild: false,
        isSelected: false,
        collapsed: false,
        t: (key: string) => key,
        renderIcon: () => null,
        onMenuItemClick: vi.fn(),
        onMenuItemContextMenu: vi.fn(),
        onRowMouseEnter: vi.fn(),
        onRowActionClick: vi.fn(),
      })
    );

    // The reveal must not animate: an animated width reflowed the label on
    // every frame, and the crossfade left the persistent glyph painted over the
    // `more` button for the duration. The layer still collapses at rest so the
    // label keeps its width — it just resizes in one step.
    expect(markup).not.toContain("transition-[max-width");
    expect(markup).not.toContain("transition-opacity");
    expect(markup).toContain("max-w-0");
    expect(markup).toContain("group-hover:opacity-0");
    expect(markup).toContain("group-hover:opacity-100");

    // The 2px edge nudge must sit ON the `overflow-hidden` layer. Inside it,
    // those 2px fall outside the clip rect and shear the last button's right
    // edge — which is exactly what the sidebar showed.
    const clippingLayer = markup.match(
      /class="[^"]*overflow-hidden[^"]*max-w-0[^"]*"|class="[^"]*max-w-0[^"]*overflow-hidden[^"]*"/
    )?.[0];
    expect(clippingLayer).toBeDefined();
    expect(clippingLayer).toContain("-mr-0.5");
    expect(markup).not.toContain('class="-mr-0.5');
  });
});
