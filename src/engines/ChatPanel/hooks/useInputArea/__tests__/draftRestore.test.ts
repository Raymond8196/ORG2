import { describe, expect, it } from "vitest";

import {
  type DraftRestoreInput,
  resolveDraftRestoreAction,
} from "../draftRestore";

function createInput(
  overrides: Partial<DraftRestoreInput> = {}
): DraftRestoreInput {
  return {
    draftSessionId: "session-b",
    seededSessionId: null,
    hasEditor: true,
    mentionMenuOpen: false,
    persistedDraft: null,
    skipReason: null,
    editorText: null,
    seededContent: null,
    editorFocused: false,
    ...overrides,
  };
}

describe("resolveDraftRestoreAction", () => {
  it("resets the seed marker when there is no session id", () => {
    expect(resolveDraftRestoreAction(createInput({ draftSessionId: "" }))).toBe(
      "reset-seed"
    );
  });

  it("skips when already seeded for the same session", () => {
    expect(
      resolveDraftRestoreAction(
        createInput({
          draftSessionId: "session-b",
          seededSessionId: "session-b",
        })
      )
    ).toBe("skip");
  });

  it("waits (without marking seeded) when the editor is not mounted yet", () => {
    expect(resolveDraftRestoreAction(createInput({ hasEditor: false }))).toBe(
      "wait"
    );
  });

  it("clears for an empty draft on a fresh session", () => {
    expect(
      resolveDraftRestoreAction(createInput({ persistedDraft: null }))
    ).toBe("clear");
    expect(resolveDraftRestoreAction(createInput({ persistedDraft: "" }))).toBe(
      "clear"
    );
  });

  it("clears when the draft is malformed (skipReason set)", () => {
    expect(
      resolveDraftRestoreAction(
        createInput({ persistedDraft: "garbage", skipReason: "too-long" })
      )
    ).toBe("clear");
  });

  it("restores a valid persisted draft on a fresh session", () => {
    expect(
      resolveDraftRestoreAction(
        createInput({ persistedDraft: "hello world", skipReason: null })
      )
    ).toBe("restore");
  });

  describe("open-menu guard (the concurrent-works slash popup bug)", () => {
    it("does not clobber when a menu is open, even with an empty draft", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({ mentionMenuOpen: true, persistedDraft: null })
        )
      ).toBe("skip-open-menu");
    });

    it("does not clobber when a menu is open, even with a restorable draft", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({ mentionMenuOpen: true, persistedDraft: "draft text" })
        )
      ).toBe("skip-open-menu");
    });

    it("does not clobber when a menu is open and the draft is malformed", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            mentionMenuOpen: true,
            persistedDraft: "garbage",
            skipReason: "too-long",
          })
        )
      ).toBe("skip-open-menu");
    });

    it("still skips for an already-seeded session regardless of menu state", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            seededSessionId: "session-b",
            mentionMenuOpen: true,
          })
        )
      ).toBe("skip");
    });

    it("still waits for an unmounted editor regardless of menu state", () => {
      // A menu cannot truly be open without a mounted editor, but the
      // mount check must take precedence to avoid marking seeded too early.
      expect(
        resolveDraftRestoreAction(
          createInput({ hasEditor: false, mentionMenuOpen: true })
        )
      ).toBe("wait");
    });
  });

  describe("live-input guard (the session-open wipe race)", () => {
    it("does not clobber user-typed text when the session id transitions", () => {
      // User is mid-composition (focused) when the incoming session's async
      // open re-targets the composer; incoming session has no persisted draft.
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "go on",
            seededContent: "",
            persistedDraft: null,
            editorFocused: true,
          })
        )
      ).toBe("skip-live-input");
    });

    it("does not clobber user text even when the incoming draft is restorable", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "go on",
            seededContent: "",
            persistedDraft: "draft text",
            editorFocused: true,
          })
        )
      ).toBe("skip-live-input");
    });

    it("does not clobber user text appended on top of a seeded draft", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "seeded draft plus typing",
            seededContent: "seeded draft",
            persistedDraft: null,
            editorFocused: true,
          })
        )
      ).toBe("skip-live-input");
    });

    it("still clears divergent text when the editor is NOT focused (deliberate switch)", () => {
      // The user clicked a sidebar session — blur already fired. This is the
      // legacy "discard the outgoing session's composer text on switch"
      // behavior and must be preserved.
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "old session leftovers",
            seededContent: "",
            persistedDraft: null,
            editorFocused: false,
          })
        )
      ).toBe("clear");
    });

    it("still clears when the editor holds exactly the seeded old draft", () => {
      // Untouched old-session state — the normal switch clear applies
      // regardless of focus.
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "old draft",
            seededContent: "old draft",
            persistedDraft: null,
            editorFocused: true,
          })
        )
      ).toBe("clear");
    });

    it("still clears when the editor is empty", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "",
            seededContent: "old draft",
            persistedDraft: null,
            editorFocused: true,
          })
        )
      ).toBe("clear");
    });

    it("protects user text even when the incoming draft is malformed", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "go on",
            seededContent: "",
            persistedDraft: "garbage",
            skipReason: "too-long",
            editorFocused: true,
          })
        )
      ).toBe("skip-live-input");
    });

    it("keeps legacy behavior when editor text is unavailable (null)", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: null,
            seededContent: "",
            editorFocused: true,
          })
        )
      ).toBe("clear");
    });

    it("treats never-seeded live text as user input", () => {
      // seededContent null (hook never seeded, e.g. seed marker was reset by
      // a transient empty draftSessionId) + non-empty focused editor text.
      expect(
        resolveDraftRestoreAction(
          createInput({
            editorText: "typed before any seed",
            editorFocused: true,
          })
        )
      ).toBe("skip-live-input");
    });

    it("an open menu still wins over the live-input guard", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            mentionMenuOpen: true,
            editorText: "go on",
            seededContent: "",
            editorFocused: true,
          })
        )
      ).toBe("skip-open-menu");
    });

    it("still skips for an already-seeded session regardless of live text", () => {
      expect(
        resolveDraftRestoreAction(
          createInput({
            seededSessionId: "session-b",
            editorText: "go on",
            seededContent: "",
            editorFocused: true,
          })
        )
      ).toBe("skip");
    });
  });
});
