// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
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
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@src/components/TabPill", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.tabPillProps = props;
    return createElement("div", { "data-testid": "pr-detail-tabs" });
  },
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
  PrConversationTab: () =>
    createElement("div", { "data-testid": "conversation-tab" }),
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

    act(() => {
      (mocks.tabPillProps?.onChange as ((key: string) => void) | undefined)?.(
        "changes"
      );
    });
    expect(store.get(workstationPrDetailTabAtomFamily(scopeKey))).toBe(
      "changes"
    );
  });
});
