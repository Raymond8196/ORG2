/**
 * Creator default TUI mode atom
 *
 * Persists the session creator's TUI mode preference to localStorage.
 * Used to pre-seed new CLI agent sessions — when a session is launched,
 * the per-session tuiModeAtom is initialised from this value.
 *
 * This atom is ONLY for the creator UI and the launch-time seeding step.
 * Once a session exists, its TUI mode lives in tuiModeAtom(sessionId).
 */
import { atomWithStorage } from "jotai/utils";

export const creatorDefaultTuiModeAtom = atomWithStorage<boolean>(
  "orgii:tuiMode:default",
  false,
  undefined,
  { getOnInit: true }
);
