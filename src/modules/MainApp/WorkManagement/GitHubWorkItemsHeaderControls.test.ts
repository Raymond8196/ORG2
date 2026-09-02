import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GitHubWorkItemsHeaderControls } from "./GitHubWorkItemsHeaderControls";

describe("GitHubWorkItemsHeaderControls", () => {
  it("keeps repository, state, personal filters, search, and actions in the shared header", () => {
    const markup = renderToStaticMarkup(
      createElement(GitHubWorkItemsHeaderControls, {
        repoOptions: [
          { key: "all", label: "All repositories" },
          { key: "org/repo", label: "org/repo" },
        ],
        selectedRepo: "all",
        stateTabs: [
          { key: "open", label: "Open" },
          { key: "closed", label: "Closed" },
        ],
        activeState: "open",
        searchQuery: "assignee:@me",
        searchPlaceholder: "Search issues",
        personalFilterOptions: [{ value: "by_me", label: "Created by me" }],
        selectedPersonalFilters: ["by_me"],
        personalFilterLabel: "Filter",
        refreshLabel: "Refresh",
        refreshing: false,
        createAction: {
          label: "Create issue",
          disabled: false,
          onClick: vi.fn(),
        },
        onRepoSelect: vi.fn(),
        onStateChange: vi.fn(),
        onSearchQueryChange: vi.fn(),
        onPersonalFiltersSelect: vi.fn(),
        onRefresh: vi.fn(),
      })
    );

    expect(markup).toContain('data-testid="github-work-items-header-controls"');
    expect(markup).toContain('data-testid="github-work-items-repository"');
    expect(markup).toContain('data-testid="github-work-items-state-open"');
    expect(markup).toContain('data-testid="github-work-items-search"');
    expect(markup).toContain('placeholder="Search issues"');
    expect(markup).toContain('aria-label="Filter (1)"');
    expect(markup).toContain('data-icon="refresh-cw"');
    expect(markup).toContain('data-icon="plus"');
    expect(markup.indexOf("All repositories")).toBeLessThan(
      markup.indexOf('placeholder="Search issues"')
    );
  });
});
