/**
 * Cursor Mode Override Atom
 *
 * Pre-launch mode pick for the SessionCreator's Cursor IDE flow.
 *
 * The SessionCreator hasn't created a session yet. It stashes the user's draft
 * mode pick here, and `useSessionLaunch` reads it once when calling
 * `cursorBridgeNewComposer` so the fresh composer is stamped with the right
 * mode after creation. Cleared after launch or creator unmount so the next
 * visit starts neutral.
 */
import { atom } from "jotai";

export const cursorCreatorModeOverrideAtom = atom<string | null>(null);
cursorCreatorModeOverrideAtom.debugLabel = "cursorCreatorModeOverride";
