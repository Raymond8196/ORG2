/**
 * Cursor Model Override Atom
 *
 * Pre-launch model pick for the SessionCreator's Cursor IDE flow.
 *
 * The SessionCreator hasn't created a session yet, so it stashes the user's
 * draft model pick here. `useSessionLaunch` reads it once when calling
 * `cursorBridgeNewComposer` so the fresh composer is born with the right
 * model. Cleared after launch or creator unmount so the next visit starts
 * neutral.
 */
import { atom } from "jotai";

export const cursorCreatorModelOverrideAtom = atom<string | null>(null);
cursorCreatorModelOverrideAtom.debugLabel = "cursorCreatorModelOverride";
