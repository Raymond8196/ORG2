/**
 * Regression tests for the bounded retry behind every lazy chunk.
 *
 * The failure these defend against is specific: on Linux WebKitGTK a chunk
 * request can stall forever without resolving *or* rejecting. A `.catch`-based
 * retry cannot observe that, so the tests below lean hard on factories that
 * return a promise which never settles — if the race is ever weakened back into
 * a rejection handler, they hang and then fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_ATTEMPTS,
  importWithRetry,
} from "@src/util/core/init/lazyWithRetry";

/** A promise that never settles — the stalled-chunk failure mode. */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* intentionally empty */
  });
}

/**
 * Total wall clock the retry loop can consume: every attempt's timeout plus
 * every inter-attempt backoff. Advancing by this much guarantees the loop has
 * run to completion regardless of how the backoff constants are tuned.
 */
function exhaustionBudget(attempts: number, attemptTimeoutMs: number): number {
  return attempts * attemptTimeoutMs + attempts * 1000;
}

describe("importWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves without arming a retry when the first attempt succeeds", async () => {
    const factory = vi.fn(() => Promise.resolve("module"));

    await expect(importWithRetry(factory, { label: "ok" })).resolves.toBe(
      "module"
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries a factory that never settles and gives up after maxAttempts", async () => {
    const factory = vi.fn(neverSettles);
    const attemptTimeoutMs = 100;

    const pending = importWithRetry(factory, {
      label: "stalled",
      attemptTimeoutMs,
      maxAttempts: 3,
    });
    const assertion = expect(pending).rejects.toThrow(/Loading chunk/);

    await vi.advanceTimersByTimeAsync(exhaustionBudget(3, attemptTimeoutMs));

    await assertion;
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("tags the exhausted error for the canonical chunk classifier", async () => {
    const attemptTimeoutMs = 100;
    const pending = importWithRetry(neverSettles, {
      label: "dead-chunk",
      attemptTimeoutMs,
      maxAttempts: 2,
    });

    const captured = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(exhaustionBudget(2, attemptTimeoutMs));

    const error = (await captured) as Error & { cause?: unknown };
    expect(error.name).toBe("ChunkLoadError");
    expect(error.message).toContain("dead-chunk");
    // The last attempt's failure is preserved so the log/report keeps the
    // original symptom (timeout vs. network error) instead of only the summary.
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("recovers when a stalled first attempt is followed by a good one", async () => {
    const attemptTimeoutMs = 100;
    const factory = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(neverSettles)
      .mockImplementationOnce(() => Promise.resolve("module"));

    const pending = importWithRetry(factory, {
      label: "flaky",
      attemptTimeoutMs,
    });

    await vi.advanceTimersByTimeAsync(exhaustionBudget(2, attemptTimeoutMs));

    await expect(pending).resolves.toBe("module");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("recovers when the first attempt rejects outright", async () => {
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("net::ERR_FAILED"))
      .mockResolvedValueOnce("module");

    const pending = importWithRetry(factory, { label: "rejecting" });

    await vi.advanceTimersByTimeAsync(exhaustionBudget(2, 12_000));

    await expect(pending).resolves.toBe("module");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("waits for webpack to clear a failed installed chunk before retrying", async () => {
    const webpackChunkTimeoutMs = 80;
    const attemptTimeoutMs = 120;
    let installedChunk: Promise<string> | null = null;
    let networkAttempts = 0;

    const factory = vi.fn(() => {
      if (!installedChunk) {
        networkAttempts += 1;
        installedChunk = new Promise<string>((resolve, reject) => {
          setTimeout(() => {
            installedChunk = null;
            if (networkAttempts === 1) {
              reject(new Error("webpack chunk timeout"));
            } else {
              resolve("module");
            }
          }, webpackChunkTimeoutMs);
        });
      }
      return installedChunk;
    });

    const pending = importWithRetry(factory, {
      label: "webpack-like",
      attemptTimeoutMs,
      maxAttempts: 2,
    });
    await vi.advanceTimersByTimeAsync(exhaustionBudget(2, attemptTimeoutMs));

    await expect(pending).resolves.toBe("module");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(networkAttempts).toBe(2);
  });

  it("swallows a late rejection from an abandoned attempt", async () => {
    // `src/index.tsx` treats an unhandled rejection as a chunk error and
    // reloads the page. An attempt that times out and *then* rejects must not
    // trip that while a later attempt is still in flight.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const attemptTimeoutMs = 100;
    let rejectFirst: ((error: Error) => void) | undefined;
    const factory = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(() => Promise.resolve("module"));

    const pending = importWithRetry(factory, {
      label: "late-reject",
      attemptTimeoutMs,
    });

    await vi.advanceTimersByTimeAsync(attemptTimeoutMs + 1);
    rejectFirst?.(new Error("arrived after the timeout"));
    await vi.advanceTimersByTimeAsync(exhaustionBudget(2, attemptTimeoutMs));

    await expect(pending).resolves.toBe("module");

    // Give the host a turn to flush any pending rejection bookkeeping.
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("defaults to a retry budget rather than a single attempt", async () => {
    const factory = vi.fn(neverSettles);
    const attemptTimeoutMs = 50;

    const pending = importWithRetry(factory, {
      label: "defaults",
      attemptTimeoutMs,
    });
    const assertion = expect(pending).rejects.toThrow(/Loading chunk/);

    await vi.advanceTimersByTimeAsync(
      exhaustionBudget(DEFAULT_MAX_ATTEMPTS, attemptTimeoutMs)
    );

    await assertion;
    expect(factory).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });
});
