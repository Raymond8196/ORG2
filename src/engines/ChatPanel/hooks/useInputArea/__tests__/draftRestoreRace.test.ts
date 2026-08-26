/**
 * Code-level reproduction of the "message silently vanishes when typing fast
 * right after a session opens" race (observed on Win10; NOT reproducible by
 * hand on fast Linux/macOS machines — see the fast-machine ordering test).
 *
 * The race as it executes in the real app. Every step is plain,
 * platform-independent JS ordering — no OS API is involved anywhere in the
 * chain (the whole path lives in the WebView: React effects + jotai atoms +
 * a contenteditable host):
 *
 *  T0  user launches/opens a session; ChatView + InputArea render, the
 *      composer editor mounts.
 *  T1  user clicks into the composer and starts typing immediately
 *      -> editor holds live text ("go on"), editor is FOCUSED.
 *  T2  a LATE `activeSessionIdAtom` writer lands (the async writers are
 *      enumerated in store/session/viewAtom.ts:110-141: the AppShell
 *      workstation->pipeline bridge, ChatHistory's empty-cache reload,
 *      claimPipelineSessionAtom after the event-load RPC, secondary-surface
 *      claim/release, jumpToSessionAtom). draftSessionId transitions
 *      (old -> "" -> new, or straight to new).
 *  T3  the per-session draft-restore effect for that transition flushes
 *      AFTER T1 (React guarantees effects run after commit, but puts NO
 *      ordering constraint between an async atom write and user input
 *      events that already landed). seededSessionId !== new id, no
 *      slash/@ menu open, new session has no persisted draft:
 *        pre-fix : resolveDraftRestoreAction -> "clear" -> editor.clear()
 *                  destroys the user's text          (THE BUG)
 *        post-fix: live-input guard -> "skip-live-input" -> text kept
 *  T4  user hits Enter. keyboard.ts:583-584 reads the editor:
 *        `const text = ctx.getText(); if (text.trim()) onSubmit(text)`
 *        pre-fix : empty text -> onSubmit never called, no else branch,
 *                  no toast, no queue entry — the message vanishes silently
 *                  (matches the reported symptom: nowhere, no queue, idle).
 *        post-fix: "go on" submits normally.
 *
 * Why hand-repro fails on fast machines: when the whole open chain (launch
 * RPC -> navigation -> pipeline claim -> event load -> re-render) finishes
 * in tens of milliseconds, T3 lands BEFORE the user's first keystroke — the
 * effect clears an EMPTY editor, which is harmless and invisible. The wipe
 * only becomes reachable when that chain stretches to hundreds of ms (cold
 * start, slow SQLite flush, AV scanning the db, busy main thread) — i.e.
 * wide-enough windows for a human to type inside. That is why the report
 * says "typing fast triggers it", "first one or two opens", "not 100%" —
 * and why a warm Linux box never hits it.
 *
 * Precedent: bec916b76 (2026-06-18) already accepted that this very effect
 * "could run late ... and clear/re-seed the composer" and added the
 * skip-open-menu guard for the menu-open flavor of the same late-run. The
 * plain-typing flavor had no guard until the live-input fix.
 */
import { describe, expect, it } from "vitest";

import { resolveDraftRestoreAction } from "../draftRestore";

/**
 * Verbatim copy of the PRE-FIX decision logic — the version shipped by
 * bec916b76 and unchanged until the live-input guard. Inlined (not
 * imported) because the production module now contains the fixed logic;
 * this copy is what proves the old behavior, i.e. that the bug is real in
 * code rather than an environment artifact.
 *
 * Differences from the fixed version: no editorText / seededContent /
 * editorFocused inputs and no live-input guard — exactly the gap.
 */
function resolveDraftRestoreActionPrefix(input: {
  draftSessionId: string;
  seededSessionId: string | null;
  hasEditor: boolean;
  mentionMenuOpen: boolean;
  persistedDraft: string | null;
  skipReason: string | null;
}): "reset-seed" | "skip" | "wait" | "skip-open-menu" | "clear" | "restore" {
  const {
    draftSessionId,
    seededSessionId,
    hasEditor,
    mentionMenuOpen,
    persistedDraft,
    skipReason,
  } = input;

  if (!draftSessionId) return "reset-seed";
  if (seededSessionId === draftSessionId) return "skip";
  if (!hasEditor) return "wait";
  if (mentionMenuOpen) return "skip-open-menu";
  if (!persistedDraft) return "clear";
  if (skipReason) return "clear";
  return "restore";
}

/**
 * Minimal model of the composer state the real effect mutates. The
 * production effect (useInputArea/index.ts draft-restore effect) maps each
 * action to editor calls 1:1; only "clear" and "restore" touch editor text,
 * so the model tracks exactly those plus the seed markers.
 */
interface ComposerSim {
  editorText: string;
  editorFocused: boolean;
  seededSessionId: string | null;
  /** Post-fix only: content produced by the last programmatic seed. */
  seededContent: string | null;
}

function runRestoreStep(
  sim: ComposerSim,
  variant: "pre" | "post",
  step: {
    draftSessionId: string;
    mentionMenuOpen: boolean;
    persistedDraft: string | null;
    hasEditor?: boolean;
  }
): void {
  const hasEditor = step.hasEditor ?? true;
  const base = {
    draftSessionId: step.draftSessionId,
    seededSessionId: sim.seededSessionId,
    hasEditor,
    mentionMenuOpen: step.mentionMenuOpen,
    persistedDraft: step.persistedDraft,
    skipReason: null,
  };
  const action =
    variant === "pre"
      ? resolveDraftRestoreActionPrefix(base)
      : resolveDraftRestoreAction({
          ...base,
          editorText: sim.editorText,
          seededContent: sim.seededContent,
          editorFocused: sim.editorFocused,
        });

  // The effect body (useInputArea/index.ts), reduced to its text/seed
  // effects. skip-open-menu/skip-live-input mark seeded WITHOUT touching
  // editor text — that asymmetry is the entire fix.
  switch (action) {
    case "reset-seed":
      sim.seededSessionId = null;
      sim.seededContent = null;
      return;
    case "skip":
    case "wait":
      return;
    case "skip-open-menu":
    case "skip-live-input":
      sim.seededSessionId = step.draftSessionId;
      sim.seededContent = sim.editorText;
      return;
    case "clear":
      sim.editorText = "";
      sim.seededSessionId = step.draftSessionId;
      sim.seededContent = "";
      return;
    case "restore":
      sim.editorText = step.persistedDraft ?? "";
      sim.seededSessionId = step.draftSessionId;
      sim.seededContent = sim.editorText;
      return;
  }
}

/** Enter handling as keyboard.ts:583-584 implements it. */
function enterSubmits(sim: ComposerSim): boolean {
  return sim.editorText.trim().length > 0;
}

describe("draft-restore race timeline (deterministic repro)", () => {
  it("PRE-FIX: late session-id transition after typing wipes the message and Enter silently no-ops", () => {
    const sim: ComposerSim = {
      editorText: "",
      editorFocused: false,
      seededSessionId: "old-session",
      seededContent: null,
    };

    // T0 — old session seeded earlier; the new session is opening.
    // T1 — user clicks in and types BEFORE the async open chain finishes.
    sim.editorFocused = true;
    sim.editorText = "go on";
    // T2/T3 — the late pipeline writer lands; new session has no draft.
    runRestoreStep(sim, "pre", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });

    // The bug, in code: the effect cleared live user text.
    expect(sim.editorText).toBe("");
    // T4 — Enter reads the now-empty editor: onSubmit is never called
    // (keyboard.ts has no else branch), so the message vanishes silently —
    // no transcript row, no queue entry, no toast.
    expect(enterSubmits(sim)).toBe(false);
  });

  it("POST-FIX: same ordering keeps the message and Enter submits it", () => {
    const sim: ComposerSim = {
      editorText: "",
      editorFocused: false,
      seededSessionId: "old-session",
      seededContent: "",
    };

    sim.editorFocused = true;
    sim.editorText = "go on";
    runRestoreStep(sim, "post", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });

    expect(sim.editorText).toBe("go on");
    expect(enterSubmits(sim)).toBe(true);
  });

  it("PRE-FIX: the double transition old -> '' -> new wipes text typed in between", () => {
    const sim: ComposerSim = {
      editorText: "",
      editorFocused: true,
      seededSessionId: "old-session",
      seededContent: null,
    };

    sim.editorText = "go on";
    // Release paths (releasePipelineSessionAtom / secondary unmount) null the
    // pipeline id first; the reclaim lands one async hop later.
    runRestoreStep(sim, "pre", {
      draftSessionId: "",
      mentionMenuOpen: false,
      persistedDraft: null,
    });
    expect(sim.seededSessionId).toBeNull();

    sim.editorText = "go on typed during the gap";
    runRestoreStep(sim, "pre", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });

    expect(sim.editorText).toBe("");
    expect(enterSubmits(sim)).toBe(false);
  });

  it("POST-FIX: the double transition preserves text typed in between", () => {
    const sim: ComposerSim = {
      editorText: "",
      editorFocused: true,
      seededSessionId: "old-session",
      seededContent: "",
    };

    sim.editorText = "go on";
    runRestoreStep(sim, "post", {
      draftSessionId: "",
      mentionMenuOpen: false,
      persistedDraft: null,
    });
    sim.editorText = "go on typed during the gap";
    runRestoreStep(sim, "post", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });

    expect(sim.editorText).toBe("go on typed during the gap");
    expect(enterSubmits(sim)).toBe(true);
  });

  it("FAST-MACHINE ordering (effect flushes before the first keystroke) is harmless in BOTH variants — why manual repro on Linux fails", () => {
    // The open chain completes in tens of ms: the id transition and its
    // effect land while the editor is still empty, before the user's first
    // keystroke. The clear hits an empty editor — invisible, no loss.
    const pre: ComposerSim = {
      editorText: "",
      editorFocused: false,
      seededSessionId: "old-session",
      seededContent: null,
    };
    runRestoreStep(pre, "pre", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });
    // User types only afterwards — text is never touched by the effect.
    pre.editorText = "go on";

    const post: ComposerSim = {
      editorText: "",
      editorFocused: false,
      seededSessionId: "old-session",
      seededContent: "",
    };
    runRestoreStep(post, "post", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });
    post.editorText = "go on";

    expect(pre.editorText).toBe("go on");
    expect(post.editorText).toBe("go on");
    expect(enterSubmits(pre)).toBe(true);
    expect(enterSubmits(post)).toBe(true);
  });

  it("the wipe requires focus + divergent text: a deliberate (blurred) switch still clears in BOTH variants", () => {
    // Behavior preservation: clicking a sidebar session blurs the editor
    // first, so the outgoing session's leftover composer text is discarded
    // on switch exactly as before the fix.
    const pre: ComposerSim = {
      editorText: "old session leftovers",
      editorFocused: false,
      seededSessionId: "old-session",
      seededContent: null,
    };
    runRestoreStep(pre, "pre", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });
    expect(pre.editorText).toBe("");

    const post: ComposerSim = {
      editorText: "old session leftovers",
      editorFocused: false,
      seededSessionId: "old-session",
      seededContent: "",
    };
    runRestoreStep(post, "post", {
      draftSessionId: "new-session",
      mentionMenuOpen: false,
      persistedDraft: null,
    });
    expect(post.editorText).toBe("");
  });
});
