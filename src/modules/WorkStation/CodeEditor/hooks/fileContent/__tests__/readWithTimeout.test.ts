/** Regression tests for the independent, defensive file-read deadline. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { READ_TIMEOUT_MS, withReadTimeout } from "../readWithTimeout";

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* intentionally empty */
  });
}

describe("withReadTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a prompt read straight through", async () => {
    await expect(
      withReadTimeout(Promise.resolve("contents"), 1000)
    ).resolves.toBe("contents");
  });

  it("rejects a read that never settles", async () => {
    const pending = withReadTimeout(neverSettles<string>(), 1000);
    const assertion = expect(pending).rejects.toThrow(/Timed out reading/);

    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it("produces a message `classifyFileError` will not truncate", async () => {
    // `classifyFileError` keeps only the text after the last colon, so a colon
    // in this message would reduce the user-visible error to a fragment.
    const pending = withReadTimeout(neverSettles<string>(), 1000);
    const captured = pending.then(
      () => null,
      (error: unknown) => error as Error
    );

    await vi.advanceTimersByTimeAsync(1001);
    expect((await captured)?.message).not.toContain(":");
  });

  it("preserves a genuine read failure instead of masking it as a timeout", async () => {
    await expect(
      withReadTimeout(Promise.reject(new Error("ENOENT")), 1000)
    ).rejects.toThrow("ENOENT");
  });

  it("consumes a rejection that lands after the deadline", async () => {
    // An unhandled rejection is treated as a chunk error at the app root and
    // reloads the page; a late IPC failure must not trigger that.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    let fail: ((error: Error) => void) | undefined;
    const read = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const pending = withReadTimeout(read, 1000);
    const settled = pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1001);
    fail?.(new Error("late failure"));
    await settled;

    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("keeps the default ceiling well above a healthy local read", () => {
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(READ_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
