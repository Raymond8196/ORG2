// @vitest-environment jsdom
//
// Covers the posted-reference half of "drop a session into a channel": a
// session reference in a stored body is promoted out of the prose into a
// `ChannelSessionCard`, other pill types stay inline on the read-only
// composer path, and a reference whose session is gone degrades instead of
// rendering a husk.
//
// `ComposerInput` is a contenteditable host with portal-mounted pills,
// impractical under jsdom, so it is stubbed the way `HumanSessionView.test.ts`
// stubs it. `useSessionTurnOverview` is stubbed because the real hook reads
// the on-disk turn index through the Tauri cache adapter.
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

import { sessionsAtom } from "@src/store/session/sessionAtom";
import type { Session } from "@src/store/session/sessionAtom/types";
import type { LocalChannelMessage } from "@src/store/ui/localChannelMessagesAtom";

import ChannelMessageRow from "./ChannelMessageRow";

interface StubbedComposerProps {
  initialContent?: string;
  editable?: boolean;
  minHeight?: number | string;
  overflowY?: string;
  className?: string;
}

const mocks = vi.hoisted(() => ({
  composerProps: [] as StubbedComposerProps[],
  openSession: vi.fn(),
  turnCount: 7,
}));

vi.mock("@src/components/ComposerInput", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@src/components/ComposerInput")>();
  const React = await import("react");
  const MockComposerInput = React.forwardRef<
    { setContent: (content: unknown) => void },
    StubbedComposerProps
  >((props, ref) => {
    mocks.composerProps.push(props);
    React.useImperativeHandle(ref, () => ({ setContent: () => undefined }));
    return React.createElement(
      "div",
      { "data-testid": "stub-composer-input" },
      props.initialContent
    );
  });
  MockComposerInput.displayName = "MockComposerInput";
  return { ...actual, default: MockComposerInput };
});

// Provider SVGs resolve to URL strings outside the vite svgr pipeline.
vi.mock("@src/components/ModelIcon", () => ({
  default: () => createElement("span", { "data-testid": "model-icon" }),
}));

vi.mock("@src/config/agentIcons", () => ({
  resolveAgentIcon: () => () =>
    createElement("i", { "data-testid": "agent-icon" }),
}));

vi.mock("@src/components/SessionHoverCard/useSessionTurnOverview", () => ({
  useSessionTurnOverview: () => ({
    turnCount: mocks.turnCount,
    workedDurationMs: null,
  }),
}));

vi.mock(
  "@src/store/chatPanel/chatPanelTabOpenAtoms",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@src/store/chatPanel/chatPanelTabOpenAtoms")
      >();
    const { atom } = await import("jotai");
    return {
      ...actual,
      openOrFocusSessionInChatPanelTabAtom: atom(
        null,
        (_get, _set, options: unknown) => {
          mocks.openSession(options);
        }
      ),
    };
  }
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "count" in options ? `${key}:${options.count}` : key,
  }),
}));

vi.mock("@src/components/MarkDown", () => ({
  default: ({ textContent }: { textContent: string }) =>
    createElement("div", { "data-testid": "markdown" }, textContent),
}));

const NOW = "2026-07-31T00:00:00.000Z";

const SESSION: Session = {
  session_id: "sess-1",
  status: "completed",
  created_at: NOW,
  updated_at: NOW,
  name: "Triage the flaky test",
  model: "claude-sonnet-4-5",
  repo_name: "ORGII",
} as Session;

function makeMessage(body: string): LocalChannelMessage {
  return {
    id: "msg-1",
    channelId: "chan-1",
    body,
    createdAt: NOW,
    editedAt: null,
    deletedAt: null,
  };
}

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("ChannelMessageRow session references", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.composerProps.length = 0;
    mocks.turnCount = 7;
    store = createStore();
    store.set(sessionsAtom, [SESSION]);
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

  function render(body: string) {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(ChannelMessageRow, {
            message: makeMessage(body),
            grouped: false,
            authorLabel: "You",
            onEdit: null,
            onDelete: null,
          })
        )
      );
    });
  }

  function card(): HTMLElement | null {
    return container.querySelector<HTMLElement>(
      "[data-testid='channel-session-card']"
    );
  }

  it("keeps a plain body on the markdown path", () => {
    render("rebasing onto hotfix-branch");

    expect(
      container.querySelector("[data-testid='markdown']")?.textContent
    ).toBe("rebasing onto hotfix-branch");
    expect(card()).toBeNull();
  });

  it("promotes a session reference into a card with its round count", () => {
    render("look at Triage-the-flaky-test [session:sess-1] before we cut");

    const rendered = card();
    expect(rendered).not.toBeNull();
    expect(rendered?.getAttribute("data-session-missing")).toBeNull();
    // The card shows the LIVE session name, not the stored snapshot.
    expect(rendered?.textContent).toContain("Triage the flaky test");
    expect(rendered?.textContent).toContain(
      "sessions:history.detail.roundCount:7"
    );

    // The reference is gone from the prose, which stays on markdown.
    const prose = container.querySelector(
      "[data-testid='markdown']"
    )?.textContent;
    expect(prose).toBe("look at before we cut");
    expect(prose).not.toContain("[session:");
  });

  it("degrades a reference whose session is not on this device", () => {
    store.set(sessionsAtom, []);
    render("Triage-the-flaky-test [session:sess-1]");

    const rendered = card();
    expect(rendered?.getAttribute("data-session-missing")).toBe("true");
    expect(rendered?.textContent).toContain("Triage-the-flaky-test");
    expect(rendered?.textContent).toContain(
      "cloud.channels.feed.sessionCardMissing"
    );
  });

  it("opens the referenced session when the card is clicked", () => {
    render("Triage-the-flaky-test [session:sess-1]");

    act(() => {
      card()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        sessionName: "Triage the flaky test",
      })
    );
  });

  it("leaves other pill types inline on the read-only composer path", () => {
    render("config.ts [file:/repo/config.ts] and Triage [session:sess-1]");

    expect(
      container.querySelector("[data-testid='channel-message-pill-body']")
    ).not.toBeNull();
    expect(container.querySelector("[data-testid='markdown']")).toBeNull();
    expect(mocks.composerProps.at(-1)).toMatchObject({
      editable: false,
      minHeight: 0,
      overflowY: "visible",
      className: "text-sm leading-6 text-text-1",
    });
    expect(mocks.composerProps.at(-1)?.initialContent).toBe(
      "config.ts [file:/repo/config.ts] and"
    );
    expect(card()).not.toBeNull();
  });
});
