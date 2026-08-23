import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const CREATOR_PINNED_ACTIONS_VISIBLE_STORAGE_KEY =
  "orgii:sessionCreator:pinnedActionsVisible";

function normalizeCreatorPinnedActionsVisible(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

const storedCreatorPinnedActionsVisibleAtom = atomWithStorage<unknown>(
  CREATOR_PINNED_ACTIONS_VISIBLE_STORAGE_KEY,
  true,
  undefined,
  { getOnInit: true }
);

/**
 * Session Creator preference for showing pinned quick-action pills.
 *
 * The preference does not delete or unpin actions. Compact and hidden-repo
 * creator surfaces ignore it because they do not expose the native menu that
 * can restore visibility.
 */
export const creatorPinnedActionsVisibleAtom = atom(
  (get) =>
    normalizeCreatorPinnedActionsVisible(
      get(storedCreatorPinnedActionsVisibleAtom)
    ),
  (_get, set, visible: boolean) =>
    set(storedCreatorPinnedActionsVisibleAtom, visible)
);
