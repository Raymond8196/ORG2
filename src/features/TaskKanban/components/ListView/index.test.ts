// @vitest-environment jsdom
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

import type { KanbanTask } from "@src/features/KanbanBoard";

import ListView from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en" },
  }),
}));

const task: KanbanTask = {
  id: "cloud-remote:session-1",
  title: "Teammate session",
  status: "in_progress",
  created_at: "2026-07-22T12:00:00.000Z",
  updated_at: "2026-07-22T12:01:00.000Z",
  createdBy: { id: "teammate-1", name: "Teammate" },
};

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("TaskKanban ListView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
    vi.unstubAllGlobals();
  });

  it("renders the supplied Take over action without also selecting the row", async () => {
    const takeOver = vi.fn();
    const onTaskClick = vi.fn();
    await act(async () => {
      root.render(
        createElement(ListView, {
          tasks: [task],
          selectedTaskId: null,
          detailPanelVisible: false,
          onTaskClick,
          renderRowAction: () =>
            createElement(
              "button",
              {
                type: "button",
                onClick: takeOver,
                "data-testid": "take-over",
              },
              "Take over"
            ),
        })
      );
    });

    expect(
      container.querySelector('[data-testid="kanban-list-session-row"]')
    ).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="take-over"]')
        ?.click()
    );

    expect(takeOver).toHaveBeenCalledTimes(1);
    expect(onTaskClick).not.toHaveBeenCalled();
  });
});
