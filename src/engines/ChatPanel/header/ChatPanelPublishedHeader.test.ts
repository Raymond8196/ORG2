import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatPanelPublishedHeader } from "./ChatPanelPublishedHeader";

describe("ChatPanelPublishedHeader", () => {
  it("renders the shared 36px leading, content, and trailing slots", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChatPanelPublishedHeader, {
        windowsHost: false,
        slots: {
          leading: React.createElement("span", null, "Leading"),
          content: React.createElement("span", null, "Content"),
          trailing: React.createElement(
            "button",
            { type: "button" },
            "Trailing"
          ),
        },
      })
    );

    expect(markup).toContain('data-testid="chat-panel-published-header"');
    expect(markup).toContain("h-9");
    expect(markup).toContain("pl-[15px]");
    expect(markup).toContain("border-b border-border-2");
    expect(markup).not.toContain("bg-chat-pane/40");
    expect(markup).not.toContain("backdrop-blur-xl");
    expect(markup).toContain("Leading");
    expect(markup).toContain("Content");
    expect(markup).toContain("Trailing");
  });

  it("omits the divider when the pane joins a following row", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChatPanelPublishedHeader, {
        windowsHost: false,
        slots: {
          content: React.createElement("span", null, "Joined content"),
          joinWithFollowingRow: true,
        },
      })
    );

    expect(markup).toContain("Joined content");
    expect(markup).not.toContain("border-b border-border-2");
  });

  it("stretches content over the row when a tab bar above owns dragging", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChatPanelPublishedHeader, {
        windowsHost: false,
        slots: { content: React.createElement("span", null, "Content") },
      })
    );

    expect(markup).toContain("flex min-w-0 flex-1 items-center");
    expect(markup).not.toContain('data-testid="published-header-drag-filler"');
  });

  it("hands the space after content to the window when it is the only chrome", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChatPanelPublishedHeader, {
        windowsHost: false,
        dragFiller: true,
        slots: { content: React.createElement("span", null, "Content") },
      })
    );

    // The filler is draggable; content no longer swallows the row.
    expect(markup).toContain('data-testid="published-header-drag-filler"');
    expect(markup).toContain("-webkit-app-region:drag");
    expect(markup).toContain("Content");
  });

  it("does not add an empty row when no pane has published controls", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(ChatPanelPublishedHeader, {
          slots: null,
          windowsHost: false,
        })
      )
    ).toBe("");
  });
});
