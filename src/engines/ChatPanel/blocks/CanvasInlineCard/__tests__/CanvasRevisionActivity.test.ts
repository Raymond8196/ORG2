// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import CanvasRevisionActivity from "../CanvasRevisionActivity";

const testState = vi.hoisted(() => ({
  locate: vi.fn(),
}));

vi.mock("@src/engines/ChatPanel/blocks/useBlockLocate", () => ({
  useBlockHeader: ({ eventId }: { eventId?: string }) => ({
    handleLocate: eventId ? testState.locate : vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      values?: Record<string, string | number>
    ) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.split(`{{${name}}}`).join(String(value)),
        fallback
      ),
  }),
}));

describe("CanvasRevisionActivity", () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps a completed targeted-edit process visible in chat history", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasRevisionActivity, {
        eventId: "revision-a",
        status: "success",
        args: {
          title: "Coffee sketch",
          edits: [
            { find: "Start", replace: "Start setup" },
            { find: "13px", replace: "15px" },
          ],
        },
      })
    );

    expect(markup).toContain('data-testid="canvas-revision-activity"');
    expect(markup).toContain("Updated Coffee sketch");
    expect(markup).toContain('title="Updated Coffee sketch"');
    expect(markup).toContain("truncate");
    expect(markup).toContain("2 targeted changes");
    expect(markup.match(/data-step-state="complete"/g)).toHaveLength(3);
  });

  it("shows a failed apply step and the validated failure detail", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasRevisionActivity, {
        eventId: "revision-a",
        status: "failed",
        args: { title: "Coffee sketch", content: "function App() {}" },
        errorDetail: "Exact source no longer matches",
      })
    );

    expect(markup).toContain("Couldn’t update Coffee sketch");
    expect(markup).toContain("Exact source no longer matches");
    expect(markup).toContain('data-step-state="failed"');
  });

  it("reuses event replay navigation to open the corresponding Canvas", () => {
    testState.locate.mockReset();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        createElement(CanvasRevisionActivity, {
          eventId: "revision-a",
          status: "success",
          args: {
            title: "Coffee sketch",
            target_event_id: "canvas-a",
            edits: [{ find: "Start", replace: "Start setup" }],
          },
        })
      )
    );

    const navigate = container.querySelector<HTMLButtonElement>(
      "[data-testid='event-navigate']"
    );
    expect(navigate).not.toBeNull();
    act(() => navigate?.click());
    expect(testState.locate).toHaveBeenCalledTimes(1);

    const header = container.querySelector<HTMLElement>(".chat-block-header");
    act(() => header?.click());
    expect(testState.locate).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    container.remove();
  });

  it("stays non-interactive when the revision event has no stable id", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasRevisionActivity, {
        status: "success",
        args: { title: "Coffee sketch" },
      })
    );

    expect(markup).not.toContain('data-testid="event-navigate"');
    expect(markup).toContain("cursor-default");
  });
});
