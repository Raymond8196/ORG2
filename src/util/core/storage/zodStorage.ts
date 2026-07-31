import type { z } from "zod/v4";

export interface ZodSyncStorage<T> {
  getItem: (key: string, initialValue: T) => T;
  setItem: (key: string, value: T) => void;
  removeItem: (key: string) => void;
  /**
   * Cross-window resync via the `storage` event (fires in every OTHER
   * window sharing the origin). Without this, jotai's atomWithStorage
   * hydrates once per window and every whole-list write clobbers changes
   * made elsewhere (last-writer-wins data loss for multi-row stores).
   */
  subscribe: (
    key: string,
    callback: (value: T) => void,
    initialValue: T
  ) => () => void;
}

export interface ZodStorageOptions<T> {
  onInvalid?: (key: string, rawValue: string, error: unknown) => void;
  writeDefaultOnInvalid?: boolean;
  /**
   * Called when persisting fails (quota exceeded, storage unavailable).
   * Default logs a warning — a failed write must degrade to
   * in-memory-only state, never throw through the caller's write path.
   */
  onWriteError?: (key: string, error: unknown) => void;
  serialize?: (value: T) => string;
  deserialize?: (rawValue: string) => unknown;
}

const defaultDeserialize = (rawValue: string): unknown => JSON.parse(rawValue);
const defaultSerialize = <T>(value: T): string => JSON.stringify(value);

export function createZodJsonStorage<T>(
  schema: z.ZodType<T>,
  options: ZodStorageOptions<T> = {}
): ZodSyncStorage<T> {
  const deserialize = options.deserialize ?? defaultDeserialize;
  const serialize = options.serialize ?? defaultSerialize;
  const onWriteError =
    options.onWriteError ??
    ((key: string, error: unknown) => {
      console.warn(`[zodStorage] persist failed for "${key}"`, error);
    });

  const parseRaw = (key: string, rawValue: string, initialValue: T): T => {
    try {
      return schema.parse(deserialize(rawValue));
    } catch (error) {
      options.onInvalid?.(key, rawValue, error);
      return initialValue;
    }
  };

  return {
    getItem: (key, initialValue) => {
      const rawValue = localStorage.getItem(key);
      if (rawValue === null) return initialValue;

      try {
        return schema.parse(deserialize(rawValue));
      } catch (error) {
        options.onInvalid?.(key, rawValue, error);
        if (options.writeDefaultOnInvalid) {
          localStorage.setItem(key, serialize(initialValue));
        }
        return initialValue;
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, serialize(value));
      } catch (error) {
        onWriteError(key, error);
      }
    },
    removeItem: (key) => {
      localStorage.removeItem(key);
    },
    subscribe: (key, callback, initialValue) => {
      if (typeof window === "undefined") return () => {};
      const handler = (event: StorageEvent) => {
        if (event.storageArea !== localStorage || event.key !== key) return;
        if (event.newValue === null) {
          callback(initialValue);
          return;
        }
        callback(parseRaw(key, event.newValue, initialValue));
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}
