import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GitHubIssue } from "@src/api/tauri/github";

import {
  GitHubIssueDetailBreadcrumb,
  shouldJoinGitHubWorkItemsHeader,
} from "./GitHubWorkItemsView";

vi.mock("@src/components/IntegrationIcon", () => ({
  default: ({ type }: { type: string }) =>
    React.createElement("span", { "data-integration-icon": type }),
}));

describe("GitHubIssueDetailBreadcrumb", () => {
  it("renders a clickable dataset parent before the issue", () => {
    const issue = {
      number: 634,
      title: "Unify breadcrumb navigation",
      state: "open",
    } as unknown as GitHubIssue;

    const markup = renderToStaticMarkup(
      React.createElement(GitHubIssueDetailBreadcrumb, {
        issue,
        parentLabel: "GitHub Issues",
        onBack: vi.fn(),
      })
    );

    expect(markup.indexOf("GitHub Issues")).toBeLessThan(
      markup.indexOf("#634")
    );
    expect(markup).toContain('role="button"');
    expect(markup).toContain("Unify breadcrumb navigation");
    expect(markup).toContain("mx-0.5 flex-shrink-0 text-fill-4");
  });

  it("joins detail headers to the issue body without a bottom divider", () => {
    expect(
      shouldJoinGitHubWorkItemsHeader({
        detailOpen: true,
        singleRowHeader: true,
      })
    ).toBe(true);
    expect(
      shouldJoinGitHubWorkItemsHeader({
        detailOpen: false,
        singleRowHeader: true,
      })
    ).toBe(false);
  });
});
