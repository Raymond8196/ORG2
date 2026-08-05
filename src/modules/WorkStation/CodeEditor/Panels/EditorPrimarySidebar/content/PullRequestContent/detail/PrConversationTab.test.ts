// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PrConversationTab } from "./PrConversationTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@src/features/Org2Cloud/useSessionReferenceDropTarget", () => ({
  useSessionReferenceDropTarget: () => ({ isDragOver: false }),
}));

vi.mock("@src/features/Org2Cloud/CloudSessionReferencePreview", () => ({
  CloudSessionReferencePreview: () => null,
}));

vi.mock("@src/modules/shared/components/RichMarkdownEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef<HTMLDivElement, Record<string, unknown>>(
      function MockRichMarkdownEditor(props, ref) {
        return createElement("div", {
          ref,
          "data-testid": props.dataTestId,
          "data-min-height": props.minHeight,
          "data-max-height": props.maxHeight,
          "data-appearance": props.appearance,
          "data-toolbar-mode": props.toolbarMode,
        });
      }
    ),
  };
});

describe("PrConversationTab", () => {
  it("keeps the issue-style comment composer inside the scrolling timeline", () => {
    const markup = renderToStaticMarkup(
      createElement(PrConversationTab, {
        detail: null,
        identity: {
          number: 42,
          title: "Match the issue composer",
          url: "https://github.com/org/repo/pull/42",
          status: "open",
          headBranch: "feature/comments",
        },
        conversation: [],
        reviews: [],
        reviewComments: [],
        loading: false,
        submittingComment: false,
        submittingReview: false,
        onAddComment: vi.fn().mockResolvedValue(undefined),
        onSubmitReview: vi.fn().mockResolvedValue(undefined),
      })
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    const scrollRegion = container.querySelector(
      '[data-testid="pr-conversation-scroll"]'
    );
    const composer = scrollRegion?.querySelector(
      '[data-testid="pr-comment-composer"]'
    );
    const editor = composer?.querySelector('[data-testid="pr-comment-editor"]');

    expect(composer).not.toBeNull();
    expect(editor?.getAttribute("data-min-height")).toBe("140");
    expect(editor?.getAttribute("data-max-height")).toBe("500");
    expect(editor?.getAttribute("data-appearance")).toBe("plain");
    expect(editor?.getAttribute("data-toolbar-mode")).toBe("inline");
    expect(composer?.querySelector(".flex-shrink-0")).toBeNull();
  });
});
