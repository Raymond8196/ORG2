import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CREATOR_PINNED_ACTIONS_VISIBLE_STORAGE_KEY,
  creatorPinnedActionsVisibleAtom,
} from "../creatorPinnedActionsVisibleAtom";

beforeEach(() => {
  localStorage.removeItem(CREATOR_PINNED_ACTIONS_VISIBLE_STORAGE_KEY);
});

function hydratedStore(): ReturnType<typeof createStore> {
  const store = createStore();
  store.sub(creatorPinnedActionsVisibleAtom, () => undefined);
  return store;
}

describe("creatorPinnedActionsVisibleAtom", () => {
  it("shows pinned actions by default", () => {
    expect(hydratedStore().get(creatorPinnedActionsVisibleAtom)).toBe(true);
  });

  it("persists a hidden choice and hydrates it in a new store", () => {
    const firstStore = hydratedStore();
    firstStore.set(creatorPinnedActionsVisibleAtom, false);

    expect(
      JSON.parse(
        localStorage.getItem(CREATOR_PINNED_ACTIONS_VISIBLE_STORAGE_KEY) ??
          "null"
      )
    ).toBe(false);

    expect(hydratedStore().get(creatorPinnedActionsVisibleAtom)).toBe(false);
  });

  it("falls back to visible for malformed persisted values", () => {
    localStorage.setItem(
      CREATOR_PINNED_ACTIONS_VISIBLE_STORAGE_KEY,
      JSON.stringify("hidden")
    );

    expect(hydratedStore().get(creatorPinnedActionsVisibleAtom)).toBe(true);
  });
});
