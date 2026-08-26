/**
 * Draft-restore decision logic for the chat composer.
 *
 * Extracted as pure logic so the "should we seed the editor with the
 * persisted draft on this render?" decision can be unit-tested without a
 * live ComposerInput / jotai session.
 *
 * Background — the concurrent-works slash-menu bug:
 *   When a session has multiple concurrent running works, switching to
 *   another running work changes the composer's `draftSessionId`. The
 *   restore effect seeds the editor with that session's persisted draft by
 *   calling `editor.clear()` / `applyParsedContent()`, both of which run
 *   `resetMentionState()` and therefore CLOSE any open slash/@ menu.
 *
 *   Frequent re-renders from the other running works (event streaming,
 *   run-view polling) can make the restore effect fire LATE — right after
 *   the user has typed "/" to open the skill popup — which then closes the
 *   popup unexpectedly.
 *
 *   The fix: when a slash/@ mention menu is already open, the user is
 *   actively interacting with a mounted, focused editor. Restoring a stale
 *   persisted draft over their live input is never desirable, so we mark the
 *   session seeded and skip the destructive restore instead of clobbering it.
 *
 *   The same reasoning covers typing without any menu open: a session-id
 *   transition that lands while the user is mid-composition (the session-open
 *   race — launch/navigation re-targets the composer asynchronously) must not
 *   wipe editor text the hook never seeded. See the live-input guard below.
 */

export type DraftRestoreAction =
  /** No session id — reset the seeded marker and do nothing. */
  | "reset-seed"
  /** Already seeded for this session id — do nothing. */
  | "skip"
  /** Editor not mounted yet — wait, do NOT mark seeded (retry next render). */
  | "wait"
  /** A slash/@ menu is open — mark seeded but DO NOT clobber live input. */
  | "skip-open-menu"
  /**
   * The editor holds non-empty text this hook never seeded — a human typed it
   * after the last programmatic seed. Mark seeded but DO NOT clobber.
   */
  | "skip-live-input"
  /** Empty or unrestorable draft — clear the editor and mark seeded. */
  | "clear"
  /** Restorable draft — apply parsed content and mark seeded. */
  | "restore";

export interface DraftRestoreInput {
  /** The session id the composer currently targets ("" when none). */
  draftSessionId: string;
  /** The session id the editor was last seeded with (null when never). */
  seededSessionId: string | null;
  /** Whether the ComposerInput editor ref is mounted. */
  hasEditor: boolean;
  /** Whether a slash or @ mention menu is currently open. */
  mentionMenuOpen: boolean;
  /** The persisted draft text for `draftSessionId` (null/empty when none). */
  persistedDraft: string | null;
  /**
   * Non-null when the persisted draft is malformed and should be discarded
   * rather than restored (see `getDraftRestoreSkipReason`).
   */
  skipReason: string | null;
  /**
   * Live plain-text content of the editor at decision time (null when the
   * editor text cannot be read — the guard is skipped and legacy behavior
   * applies).
   */
  editorText: string | null;
  /**
   * The content this hook last seeded programmatically (via `clear` or
   * `restore`), or null when it never seeded anything. Editor text that
   * differs from it was typed by the user after the last seed.
   */
  seededContent: string | null;
  /**
   * Whether the editor currently holds keyboard focus. Focus discriminates
   * deliberate session switches (user clicked elsewhere — blur already
   * fired, legacy clear/restore applies) from a session id that re-targeted
   * the composer while the user was mid-composition (the session-open race).
   */
  editorFocused: boolean;
}

/**
 * Decide what the draft-restore effect should do this render.
 *
 * Order matters — the open-menu guard is checked BEFORE the
 * clear/restore branches so a late effect run can never close an open
 * slash/@ popup by clearing or re-seeding the editor.
 */
export function resolveDraftRestoreAction(
  input: DraftRestoreInput
): DraftRestoreAction {
  const {
    draftSessionId,
    seededSessionId,
    hasEditor,
    mentionMenuOpen,
    persistedDraft,
    skipReason,
    editorText,
    seededContent,
    editorFocused,
  } = input;

  if (!draftSessionId) return "reset-seed";
  if (seededSessionId === draftSessionId) return "skip";
  if (!hasEditor) return "wait";
  if (mentionMenuOpen) return "skip-open-menu";
  // Live-input guard (the session-open wipe race): when the composer's
  // session id transitions while the user is mid-composition (focused editor,
  // e.g. a newly launched session finishes its async open and re-targets the
  // composer), clearing/re-seeding here would destroy text a human just
  // typed. The upcoming Enter would then find an empty editor and silently
  // no-op — the message vanishes without any trace. Focus is the
  // discriminator: a deliberate switch to another session blurs the editor
  // first, so the legacy clear/restore still applies there. Text that
  // exactly matches the last programmatic seed is untouched old-session
  // state and stays clearable even while focused.
  if (
    editorFocused &&
    editorText !== null &&
    editorText.trim().length > 0 &&
    editorText !== seededContent
  ) {
    return "skip-live-input";
  }
  if (!persistedDraft) return "clear";
  if (skipReason) return "clear";
  return "restore";
}
