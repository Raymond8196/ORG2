import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  IssuePersonalFilterDropdown,
  ManagedPrRow,
  RepoFilterPill,
} from "./GitHubWorkItemControls";
import { GITHUB_ITEM_KIND, type ManagedPrItem } from "./githubWorkItemsModel";

const draftPr: ManagedPrItem = {
  kind: GITHUB_ITEM_KIND.PR,
  id: 465,
  title: "Consolidate audited workspace refactors",
  repo: "yorgai/ORG2",
  repoId: "repo-1",
  repoPath: "/workspace/ORG2",
  remoteUrl: "https://github.com/yorgai/ORG2.git",
  rawPr: {
    number: 465,
    url: "https://github.com/yorgai/ORG2/pull/465",
    title: "Consolidate audited workspace refactors",
    state: "open",
    head_branch: "audit-workspace",
    base_branch: "develop",
    draft: true,
    created_at: "2026-07-21T08:00:00Z",
    updated_at: "2026-07-21T08:10:00Z",
  },
  author: "junyu",
  timeAgo: "10m ago",
  state: "open",
  sourceBranch: "audit-workspace",
  targetBranch: "develop",
  updatedAt: "2026-07-21T08:10:00Z",
};

describe("ManagedPrRow", () => {
  it("uses the GitHub draft icon without a Draft tag", () => {
    const markup = renderToStaticMarkup(
      createElement(ManagedPrRow, {
        pr: draftPr,
        addLabel: "Add",
        onOpenPr: vi.fn(),
        onAddPr: vi.fn(),
      })
    );

    expect(markup).toContain("lucide-git-pull-request-draft");
    expect(markup).not.toContain(">Draft<");
  });
});

describe("GitHub work-item header controls", () => {
  it("uses the Select option icon contract for repository choices", () => {
    const markup = renderToStaticMarkup(
      createElement(RepoFilterPill, {
        options: [
          { key: "all", label: "All repositories" },
          { key: "yorgai/ORG2", label: "yorgai/ORG2" },
        ],
        selectedRepo: "yorgai/ORG2",
        allReposLabel: "All repositories",
        onSelectRepo: vi.fn(),
      })
    );

    expect(markup).toContain("lucide-code-xml");
    expect(markup).toContain("yorgai/ORG2");
  });

  it("renders Filter as a secondary icon-only button", () => {
    const markup = renderToStaticMarkup(
      createElement(IssuePersonalFilterDropdown, {
        options: [{ value: "byMe", label: "Created by me" }],
        selectedFilters: ["byMe"],
        filterLabel: "Filter",
        onSelect: vi.fn(),
      })
    );

    expect(markup).toContain("lucide-funnel");
    expect(markup).toContain('aria-label="Filter (1)"');
    expect(markup).not.toContain(">Filter<");
  });
});
