import { createStore } from "jotai/vanilla";

import {
  requestSessionSidebarRevealAtom,
  sessionSidebarRevealRequestAtom,
} from "../sidebarAtom";

describe("requestSessionSidebarRevealAtom", () => {
  it("normalizes identities and increments repeated reveal requests", () => {
    const store = createStore();

    store.set(requestSessionSidebarRevealAtom, {
      sessionId: " child-session ",
      parentSessionId: " root-session ",
    });
    expect(store.get(sessionSidebarRevealRequestAtom)).toEqual({
      sessionId: "child-session",
      parentSessionId: "root-session",
      requestId: 1,
    });

    store.set(requestSessionSidebarRevealAtom, {
      sessionId: "child-session",
      parentSessionId: "root-session",
    });
    expect(store.get(sessionSidebarRevealRequestAtom)?.requestId).toBe(2);
  });

  it("ignores an empty canonical session ID", () => {
    const store = createStore();

    store.set(requestSessionSidebarRevealAtom, { sessionId: "   " });

    expect(store.get(sessionSidebarRevealRequestAtom)).toBeNull();
  });
});
