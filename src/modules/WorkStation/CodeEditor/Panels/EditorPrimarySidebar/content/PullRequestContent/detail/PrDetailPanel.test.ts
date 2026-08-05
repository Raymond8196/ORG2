// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  initialSelectedPrState,
  workstationPrDetailTabAtomFamily,
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { PrDetailPanel } from "./PrDetailPanel";

const mocks = vi.hoisted(() => ({
  tabPillProps: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === "string") return fallback;
      if (typeof fallback?.defaultValue !== "string") return key;
      const count = Number(fallback.count ?? 0);
      const template =
        count === 1 || typeof fallback.defaultValue_other !== "string"
          ? fallback.defaultValue
          : fallback.defaultValue_other;
      return template.replace("{{count}}", String(count));
    },
  }),
}));

vi.mock("@src/components/TabPill", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.tabPillProps = props;
    return createElement("div", { "data-testid": "pr-detail-tabs" });
  },
}));

vi.mock("@src/components/IntegrationIcon", () => ({
  default: () => createElement("span", { "data-testid": "github-icon" }),
}));

vi.mock("../../../hooks/useWorkstationPrDetail", () => ({
  useWorkstationPrDetail: () => ({
    repoFullName: "org/repo",
    addComment: vi.fn(),
    submitReview: vi.fn(),
    replyInlineComment: vi.fn(),
  }),
}));

vi.mock("./PrConversationTab", () => ({
  PrConversationTab: ({ summary }: { summary?: ReactNode }) =>
    createElement("div", { "data-testid": "conversation-tab" }, summary),
}));
vi.mock("./PrChangesTab", () => ({
  PrChangesTab: () => createElement("div"),
}));
vi.mock("./PrChecksTab", () => ({
  PrChecksTab: () => createElement("div"),
}));
vi.mock("./PrCommitsTab", () => ({
  PrCommitsTab: () => createElement("div"),
}));

describe("PrDetailPanel tabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.tabPillProps = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("uses the standard pill treatment instead of the inline button group", () => {
    const store = createStore();
    const scopeKey = workstationPrScopeKey(undefined, "/repo", 42);
    store.set(workstationSelectedPrAtomFamily(scopeKey), {
      ...initialSelectedPrState,
      loading: false,
      commits: [{}],
    });

    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(PrDetailPanel, {
            identity: {
              number: 42,
              title: "Use shared TabPill",
              url: "https://github.com/org/repo/pull/42",
              status: "open",
              headBranch: "feature/tab-pill",
              baseBranch: "main",
            },
            repoPath: "/repo",
            showHeader: false,
          })
        )
      );
    });

    expect(mocks.tabPillProps).toMatchObject({
      variant: "pill",
      color: "fill",
      fillWidth: false,
      size: "small",
    });
    expect(mocks.tabPillProps?.buttonStyle).toBeUndefined();
    expect(mocks.tabPillProps?.height).toBeUndefined();
    const commitsTab = (
      mocks.tabPillProps?.tabs as
        | Array<{
            key: string;
            badge?: { props?: { className?: string } };
          }>
        | undefined
    )?.find((tab) => tab.key === "commits");
    expect(commitsTab?.badge?.props?.className).toContain("font-semibold");
    expect(commitsTab?.badge?.props?.className).not.toContain("rounded-full");
    expect(commitsTab?.badge?.props?.className).not.toContain("bg-fill-2");

    act(() => {
      (mocks.tabPillProps?.onChange as ((key: string) => void) | undefined)?.(
        "changes"
      );
    });
    expect(store.get(workstationPrDetailTabAtomFamily(scopeKey))).toBe(
      "changes"
    );
  });

  it("keeps the GitHub header at 40px and moves branch details into the Codex-style summary", () => {
    const store = createStore();
    const scopeKey = workstationPrScopeKey(undefined, "/repo", 42);
    store.set(workstationSelectedPrAtomFamily(scopeKey), {
      ...initialSelectedPrState,
      loading: false,
      detail: {
        additions: 2313,
        deletions: 217,
        comments: 1,
        requested_reviewers: [
          {
            login: "reviewer",
            avatar_url: "https://example.com/reviewer.png",
          },
        ],
      },
    });

    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(PrDetailPanel, {
            identity: {
              number: 42,
              title: "Use compact PR metadata",
              url: "https://github.com/org/repo/pull/42",
              status: "merged",
              headBranch: "fix/issue-556-delete-agent-org-workers",
              baseBranch: "develop",
            },
            repoPath: "/repo",
            headerActions: createElement("button", {
              "data-testid": "host-header-action",
            }),
          })
        )
      );
    });

    const header = container.querySelector("[data-testid='pr-detail-header']");
    const summary = container.querySelector(
      "[data-testid='pr-detail-summary']"
    );

    expect(header?.className).toContain("h-10");
    expect(header?.className).toContain("!pl-4");
    expect(header?.className).toContain("!pr-[7px]");
    expect(
      header?.querySelector('[data-testid="host-header-action"]')
    ).not.toBeNull();
    expect(header?.textContent).toContain("Use compact PR metadata");
    expect(header?.textContent).not.toContain("develop");
    expect(header?.textContent).not.toContain(
      "fix/issue-556-delete-agent-org-workers"
    );

    expect(summary?.textContent).toContain("Branch");
    expect(summary?.textContent).toContain(
      "fix/issue-556-delete-agent-org-workers"
    );
    expect(summary?.textContent).toContain("develop");
    expect(summary?.textContent).toContain("+2,313");
    expect(summary?.textContent).toContain("-217");
    expect(summary?.textContent).toContain("Reviewers");
    expect(summary?.textContent).toContain("Comments");
    expect(summary?.textContent).toContain("1 comment");
    expect(summary?.textContent).toContain("Checks");
    expect(summary?.textContent).toContain("No CI checks");
    expect(summary?.textContent).toContain("Status");
    expect(summary?.textContent).toContain("merged");
    expect(summary?.className).not.toContain("border-b");
    expect(summary?.firstElementChild?.className).toContain("px-6");
    expect(summary?.firstElementChild?.className).toContain("pt-4");
    expect(summary?.firstElementChild?.className).not.toContain("py-4");
  });
});
