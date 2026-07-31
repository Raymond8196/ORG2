// @vitest-environment jsdom
//
// `InputArea` is a rich contenteditable composer (Lexical-style editor, slash
// menus, draft persistence) and is impractical to type into under jsdom, so it
// is stubbed here the same way `HumanSessionView.test.ts` stubs it. The stub
// records the props the surface passes, which keeps the real coverage: the
// post path is exercised by invoking the surface's own `onSubmitOverride`
// against the real jotai store, and the cloud gate is asserted through
// `submitDisabled` instead of through the absence of an input.
//
// The old "textarea value is cleared after a send" assertion is gone on
// purpose: clearing is now `useSubmitMessage`'s optimistic-clear, not this
// surface's business. What this surface owns — accept / refuse / report — is
// unit-tested in `channelPostHandler.test.ts`.
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

import type { SubmitOverrideInput } from "@src/engines/ChatPanel/hooks/useInputArea/types";
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

interface StubbedInputAreaProps {
  sessionId?: string;
  placeholder?: string;
  submitDisabled?: boolean;
  showAgentControls?: boolean;
  allowFileAttachments?: boolean;
  enableAgentInterceptors?: boolean;
  sessionScope?: string;
  onSubmitOverride?: (input: SubmitOverrideInput) => Promise<boolean>;
}

const mocks = vi.hoisted(() => ({
  inputAreaProps: [] as StubbedInputAreaProps[],
}));

vi.mock("@src/engines/ChatPanel/InputArea", () => ({
  default: (props: StubbedInputAreaProps) => {
    mocks.inputAreaProps.push(props);
    return createElement("div", {
      "data-testid": "channel-input-area",
      "data-submit-disabled": String(props.submitDisabled ?? false),
      "data-session-id": props.sessionId ?? "",
      "data-placeholder": props.placeholder ?? "",
    });
  },
}));

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

const CLOUD_TARGET: ChatPanelSelectedChannel = {
  scope: "cloud",
  orgId: "org-1",
  channelId: "cloud-chan-1",
  name: "release-notes",
  visibility: "private",
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
    mocks.inputAreaProps.length = 0;
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

  function composerElement(): HTMLElement | null {
    return container.querySelector<HTMLElement>(
      "[data-testid='channel-input-area']"
    );
  }

  function latestComposerProps(): StubbedInputAreaProps {
    const props = mocks.inputAreaProps.at(-1);
    if (!props) throw new Error("InputArea was never rendered");
    return props;
  }

  /** Drives the surface exactly the way `useSubmitMessage` drives it. */
  async function submit(text: string): Promise<void> {
    const { onSubmitOverride } = latestComposerProps();
    if (!onSubmitOverride) throw new Error("no onSubmitOverride");
    await act(async () => {
      await onSubmitOverride({ displayText: text });
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

  it("mounts the session composer, not a bespoke textarea", () => {
    render();

    const composer = composerElement();
    expect(composer).not.toBeNull();
    expect(composer?.getAttribute("data-submit-disabled")).toBe("false");
    expect(composer?.getAttribute("data-session-id")).toBe(
      "channel-local-chan-1"
    );
    expect(composer?.getAttribute("data-placeholder")).toBe(
      "cloud.channels.feed.composerPlaceholder"
    );
    expect(
      container.querySelector("[data-testid='channel-composer-input']")
    ).toBeNull();
  });

  it("keeps the composer human-only — no agent controls, uploads, or interceptors", () => {
    render();

    expect(latestComposerProps()).toMatchObject({
      sessionScope: "none",
      showAgentControls: false,
      allowFileAttachments: false,
      enableAgentInterceptors: false,
    });
  });

  it("constrains the transcript to the shared detail-panel column", () => {
    store.set(localChannelMessagesAtom, [makeMessage()]);
    render();

    const scroller = container.querySelector(
      "[data-testid='channel-message-list']"
    );
    expect(scroller?.className).toContain("px-2");
    expect(scroller?.firstElementChild?.className).toContain("max-w-[900px]");
    expect(scroller?.firstElementChild?.className).toContain("mx-auto");
  });

  it("posts a new message through the composer and renders it", async () => {
    render();
    await submit("rebase onto hotfix-branch");

    expect(
      store.get(localChannelMessagesAtom).map((message) => message.body)
    ).toEqual(["rebase onto hotfix-branch"]);
    expect(bodies()).toEqual(["rebase onto hotfix-branch"]);
  });

  it("rejects a refused post so the composer restores the draft, and shows why", async () => {
    render();

    const { onSubmitOverride } = latestComposerProps();
    await act(async () => {
      // Throwing is `useSubmitMessage`'s restore signal — a resolved `false`
      // would instead fall through to the agent submit path.
      await expect(
        onSubmitOverride?.({ displayText: "x".repeat(4001) })
      ).rejects.toThrow("cloud.channels.feed.errorTooLong");
    });

    expect(store.get(localChannelMessagesAtom)).toEqual([]);
    expect(
      container.querySelector("[data-testid='channel-composer-error']")
        ?.textContent
    ).toBe("cloud.channels.feed.errorTooLong");
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
    expect(composerElement()).toBeNull();
  });

  it("gates the cloud composer as a disabled session composer, not a stand-in", () => {
    render(CLOUD_TARGET);

    const composer = composerElement();
    expect(composer).not.toBeNull();
    expect(composer?.getAttribute("data-submit-disabled")).toBe("true");
    expect(composer?.getAttribute("data-session-id")).toBe(
      "channel-cloud-org-1-cloud-chan-1"
    );
    expect(
      container.querySelector("[data-testid='channel-composer-disabled']")
        ?.textContent
    ).toBe("cloud.channels.feed.cloudComposerDisabled");
    expect(
      container.querySelector("[data-testid='channel-panel-member-count']")
        ?.textContent
    ).toContain("cloud.channels.feed.memberCount");
  });

  it("never writes to the local store from the cloud surface", async () => {
    render(CLOUD_TARGET);
    await submit("this must not land anywhere");

    expect(store.get(localChannelMessagesAtom)).toEqual([]);
  });
});
