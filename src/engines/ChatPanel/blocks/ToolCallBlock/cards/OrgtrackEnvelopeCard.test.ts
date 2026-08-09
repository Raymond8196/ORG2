// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import { stationChatVisibilityAtom } from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

import type { OrgtrackEnvelopeData } from "../types";
import OrgtrackEnvelopeCard from "./OrgtrackEnvelopeCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const NOW = "2026-08-09T00:00:00.000Z";
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function createdCard(): OrgtrackEnvelopeData {
  return {
    command: "org2-pm work create --standalone --title Card",
    ok: true,
    operationId: "work.create",
    operation: "Created work item",
    exitCode: 0,
    shortId: "WI-0101",
    title: "Card",
    status: "backlog",
    isStandalone: true,
    workItem: {
      body: "Open this item",
      filename: "WI-0101",
      frontmatter: {
        id: "WI-0101",
        short_id: "WI-0101",
        title: "Card",
        status: "backlog",
        priority: "none",
        labels: [],
        todos: [],
        starred: false,
        created_at: NOW,
        updated_at: NOW,
      },
    },
  };
}

describe("OrgtrackEnvelopeCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("switches to My Station and opens the created item detail", () => {
    const store = createStore();
    store.set(stationModeAtom, "agent-station");
    store.set(stationChatVisibilityAtom, {
      "my-station": false,
      "agent-station": true,
    });

    act(() => {
      root = createRoot(container);
      root.render(
        createElement(
          Provider,
          { store },
          createElement(OrgtrackEnvelopeCard, { card: createdCard() })
        )
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="created-work-item-card"]'
    );
    expect(button).not.toBeNull();

    act(() => button?.click());

    expect(store.get(stationModeAtom)).toBe("my-station");
    expect(store.get(stationChatVisibilityAtom)["my-station"]).toBe(true);
    const tabs = store.get(chatPanelTabsAtom);
    const activeTab = tabs.tabs.find((tab) => tab.id === tabs.activeTabId);
    expect(activeTab).toMatchObject({
      type: "work-item",
      title: "Card",
      workItem: {
        shortId: "WI-0101",
        projectSlug: "",
      },
    });
  });
});
