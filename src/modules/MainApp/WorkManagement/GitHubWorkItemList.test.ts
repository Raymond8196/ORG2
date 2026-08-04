import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  GitHubWorkItemListFrame,
  GitHubWorkItemRow,
  GitHubWorkItemSearch,
  GitHubWorkItemSection,
  GitHubWorkItemStateTabs,
  GitHubWorkItemTableSurface,
  GitHubWorkItemToolbarActions,
  shouldUseSingleRowGitHubWorkItemsHeader,
} from "./GitHubWorkItemList";

describe("shouldUseSingleRowGitHubWorkItemsHeader", () => {
  it("combines controls and search only when the surface is wide enough", () => {
    expect(shouldUseSingleRowGitHubWorkItemsHeader(649)).toBe(false);
    expect(shouldUseSingleRowGitHubWorkItemsHeader(650)).toBe(true);
  });
});

describe("GitHubWorkItemTableSurface", () => {
  it("uses the full available width for the standard Work table", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemTableSurface, null, "Table")
    );

    expect(markup).toContain("min-h-0 w-full flex-1");
    expect(markup).not.toContain("max-w-[932px]");
  });
});

describe("GitHubWorkItemListFrame", () => {
  it("renders square full-width table boundaries instead of a floating card", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemListFrame, null, "Rows")
    );

    expect(markup).toContain("border-y border-border-2");
    expect(markup).not.toContain("rounded-lg");
  });
});

describe("GitHubWorkItemRow", () => {
  it("uses a compact standard table-row height", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemRow, {
        icon: "Icon",
        content: "Content",
      })
    );

    expect(markup).toContain("min-h-[52px]");
    expect(markup).toContain("items-center");
  });
});

describe("GitHubWorkItemSearch", () => {
  it("fills the available width in either responsive header row", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemSearch, {
        value: "is:issue is:open",
        placeholder: "Search issues",
        onChange: vi.fn(),
      })
    );

    expect(markup).toContain("min-w-0 flex-1");
    expect(markup).toContain('aria-label="Search issues"');
  });
});

describe("GitHubWorkItemSection", () => {
  it("labels personal pull-request buckets for assistive technology", () => {
    const markup = renderToStaticMarkup(
      createElement(
        GitHubWorkItemSection,
        {
          label: "Review requested",
          testId: "github-pr-review-requested",
        },
        createElement("div", null, "PR row")
      )
    );

    expect(markup).toContain('aria-label="Review requested"');
    expect(markup).toContain('data-testid="github-pr-review-requested"');
    expect(markup).toContain('data-testid="github-pr-review-requested-toggle"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("lucide-chevron-down");
    expect(markup).toContain(">Review requested<");
  });
});

describe("GitHubWorkItemToolbarActions", () => {
  it("renders Refresh before the compact SquarePen create action", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemToolbarActions, {
        refreshLabel: "Refresh",
        refreshing: false,
        createAction: {
          label: "Create issue",
          disabled: false,
          onClick: vi.fn(),
        },
        onRefresh: vi.fn(),
      })
    );

    expect(markup.indexOf('aria-label="Refresh"')).toBeLessThan(
      markup.indexOf('aria-label="Create issue"')
    );
    expect(markup).toContain('class="lucide lucide-square-pen"');
    expect(markup).toContain('width="14"');
    expect(markup).toContain('height="14"');
  });
});

describe("GitHubWorkItemStateTabs", () => {
  it("renders accessible icon-only Open and Closed controls", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemStateTabs, {
        activeTab: "open",
        onChange: vi.fn(),
        tabs: [
          {
            key: "open",
            label: "Open",
          },
          {
            key: "closed",
            label: "Closed",
          },
        ],
      })
    );

    expect(markup).toContain('data-testid="github-work-items-state-open"');
    expect(markup).toContain('data-testid="github-work-items-state-closed"');
    expect(markup).toContain("lucide-circle-dot");
    expect(markup).toContain("lucide-circle-check");
    expect(markup).toContain("text-success-6");
    expect(markup).toContain("text-purple-6");
    expect(markup).toContain('class="sr-only">Open</span>');
    expect(markup).toContain('class="sr-only">Closed</span>');
    expect(markup).toContain("rounded-[100px]");
    expect(markup).not.toContain(
      "rounded-lg border border-border-2 bg-bg-2 p-0.5"
    );
  });
});
