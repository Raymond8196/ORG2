import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { createZodJsonStorage } from "./zodStorage";

const ListSchema = z.array(z.string());

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createZodJsonStorage", () => {
  it("degrades a failed persist to onWriteError instead of throwing", () => {
    const onWriteError = vi.fn();
    const storage = createZodJsonStorage(ListSchema, { onWriteError });
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => storage.setItem("k", ["a"])).not.toThrow();
    expect(onWriteError).toHaveBeenCalledWith("k", expect.anything());
    setItem.mockRestore();
  });

  it("subscribe resyncs from another window's storage event", () => {
    // The stubbed test window does not deliver dispatched events, so capture
    // the registered handler and drive it with StorageEvent-shaped objects.
    const listeners: EventListener[] = [];
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener) => {
        if (type === "storage") listeners.push(listener as EventListener);
      });
    const removeSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation(() => {});

    const storage = createZodJsonStorage(ListSchema);
    const seen: string[][] = [];
    const unsubscribe = storage.subscribe("k", (value) => seen.push(value), []);
    expect(listeners).toHaveLength(1);
    const emit = (key: string, newValue: string | null) =>
      listeners[0]?.({
        key,
        newValue,
        storageArea: localStorage,
      } as unknown as Event);

    emit("k", JSON.stringify(["from-other-window"]));
    expect(seen).toEqual([["from-other-window"]]);
    // Removal in the other window resets to the initial value.
    emit("k", null);
    expect(seen).toEqual([["from-other-window"], []]);
    // Unrelated keys and invalid payloads never surface raw.
    emit("other", JSON.stringify(["x"]));
    emit("k", "{not json");
    expect(seen).toEqual([["from-other-window"], [], []]);

    unsubscribe();
    expect(removeSpy).toHaveBeenCalledWith("storage", listeners[0]);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
