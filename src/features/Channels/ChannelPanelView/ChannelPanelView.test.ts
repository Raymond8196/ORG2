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

import type { ChatPanelSelectedChannel } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  LOCAL_CHANNEL_MESSAGES_STORAGE_KEY,
  type LocalChannelMessage,
  localChannelMessagesAtom,
} from "@src/store/ui/localChannelMessagesAtom";
import {
  LOCAL_CHANNELS_STORAGE_KEY,
  type LocalChannel,
  localChannelsAtom,
} from "@src/store/ui/localChannelsAtom";

import ChannelPanelView from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The real Markdown component is lazy-loaded behind Suspense; a plain
// passthrough keeps the body assertions synchronous.
vi.mock("@src/components/MarkDown", () => ({
  default: ({ textContent }: { textContent: string }) =>
    createElement("div", { "data-testid": "markdown" }, textContent),
}));

vi.mock("@src/features/Org2Cloud/channels/useOrgChannels", () => ({
  useOrgChannels: () => ({
    phase: "ready",
    channels: [
      {
        id: "cloud-chan-1",
        name: "release-notes",
        topic: "what shipped",
        visibility: "private",
        postPolicy: "everyone",
        createdBy: "user-self",
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: undefined,
        archivedAt: null,
        messageCount: 0,
        lastMessageAt: undefined,
        memberCount: 4,
        myRole: "manager",
      },
    ],
    archivedChannels: [],
    error: null,
    refreshing: false,
    refresh: vi.fn(),
    getFreshAccessToken: vi.fn(),
    currentUserId: "user-self",
  }),
}));

const NOW = "2026-07-31T00:00:00.000Z";

const CHANNEL: LocalChannel = {
  id: "chan-1",
  name: "code-review",
  topic: "PR triage",
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
};

const LOCAL_TARGET: ChatPanelSelectedChannel = {
  scope: "local",
  channelId: "chan-1",
  name: "code-review",
};

function makeMessage(
  overrides: Partial<LocalChannelMessage> = {}
): LocalChannelMessage {
  return {
    id: "msg-1",
    channelId: "chan-1",
    body: "hotfix-branch is ready for review",
    createdAt: NOW,
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("ChannelPanelView", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(LOCAL_CHANNELS_STORAGE_KEY);
    localStorage.removeItem(LOCAL_CHANNEL_MESSAGES_STORAGE_KEY);
    store = createStore();
    store.set(localChannelsAtom, [CHANNEL]);
    store.set(localChannelMessagesAtom, []);
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

  function render(channel: ChatPanelSelectedChannel = LOCAL_TARGET) {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(ChannelPanelView, { channel })
        )
      );
    });
  }

  function bodies(): string[] {
    return Array.from(
      container.querySelectorAll("[data-testid='markdown']")
    ).map((node) => node.textContent ?? "");
  }

  function typeIntoComposer(value: string) {
    const input = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='channel-composer-input']"
    );
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      valueSetter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function clickSend() {
    const button = container.querySelector<HTMLButtonElement>(
      "[data-testid='channel-composer-send']"
    );
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("renders the header with the channel name and topic", () => {
    render();
    expect(
      container.querySelector("[data-testid='channel-panel-title']")
        ?.textContent
    ).toBe("code-review");
    expect(
      container.querySelector("[data-testid='channel-panel-topic']")
        ?.textContent
    ).toBe("PR triage");
  });

  it("shows the empty placeholder when the channel has no messages", () => {
    render();
    expect(
      container.querySelectorAll("[data-testid='channel-message']")
    ).toHaveLength(0);
    expect(bodies()).toEqual([]);
  });

  it("renders already-posted messages with a date divider", () => {
    store.set(localChannelMessagesAtom, [
      makeMessage({ id: "a", body: "code-review queue is empty" }),
      makeMessage({
        id: "b",
        body: "cutting release-notes now",
        createdAt: "2026-07-31T06:00:00.000Z",
      }),
    ]);
    render();

    expect(bodies()).toEqual([
      "code-review queue is empty",
      "cutting release-notes now",
    ]);
    expect(
      container.querySelectorAll("[data-testid='channel-date-divider']").length
    ).toBeGreaterThan(0);
  });

  it("posts a new message through the composer and renders it", () => {
    render();
    typeIntoComposer("rebase onto hotfix-branch");
    clickSend();

    expect(
      store.get(localChannelMessagesAtom).map((message) => message.body)
    ).toEqual(["rebase onto hotfix-branch"]);
    expect(bodies()).toEqual(["rebase onto hotfix-branch"]);
  });

  it("clears the composer after a successful post", () => {
    render();
    typeIntoComposer("ship it");
    clickSend();

    const input = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='channel-composer-input']"
    );
    expect(input?.value).toBe("");
  });

  it("keeps the draft and surfaces an error when the post is refused", () => {
    render();
    typeIntoComposer("x".repeat(4001));
    clickSend();

    expect(store.get(localChannelMessagesAtom)).toEqual([]);
    expect(
      container.querySelector("[data-testid='channel-composer-error']")
        ?.textContent
    ).toBe("cloud.channels.feed.errorTooLong");
    const input = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='channel-composer-input']"
    );
    expect(input?.value).toBe("x".repeat(4001));
  });

  it("renders a deleted message as a tombstone, not as its old body", () => {
    store.set(localChannelMessagesAtom, [
      makeMessage({ id: "gone", body: "leaked", deletedAt: NOW }),
    ]);
    render();

    expect(
      container.querySelector("[data-testid='channel-message-tombstone']")
        ?.textContent
    ).toBe("cloud.channels.feed.deletedMessage");
    expect(bodies()).toEqual([]);
  });

  it("deletes a message in place through the row action", () => {
    store.set(localChannelMessagesAtom, [makeMessage()]);
    render();

    const deleteButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='channel-message-delete']"
    );
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(store.get(localChannelMessagesAtom)[0]).toMatchObject({
      body: "",
      deletedAt: expect.any(String),
    });
    expect(
      container.querySelector("[data-testid='channel-message-tombstone']")
    ).not.toBeNull();
  });

  it("reports a channel deleted out from under an open tab", () => {
    store.set(localChannelsAtom, []);
    render();

    expect(
      container.querySelector("[data-testid='channel-panel-header']")
    ).toBeNull();
    expect(container.textContent).toContain("cloud.channels.feed.missingTitle");
  });

  it("gates the cloud composer with an explanation instead of an input", () => {
    render({
      scope: "cloud",
      orgId: "org-1",
      channelId: "cloud-chan-1",
      name: "release-notes",
      visibility: "private",
    });

    expect(
      container.querySelector("[data-testid='channel-composer-input']")
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='channel-composer-disabled']")
        ?.textContent
    ).toBe("cloud.channels.feed.cloudComposerDisabled");
    expect(
      container.querySelector("[data-testid='channel-panel-member-count']")
        ?.textContent
    ).toContain("cloud.channels.feed.memberCount");
  });
});
