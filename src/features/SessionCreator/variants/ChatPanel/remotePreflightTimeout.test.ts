import { describe, expect, it, vi } from "vitest";

import {
  remotePreflightTimeoutMessage,
  withRemotePreflightTimeout,
} from "./remotePreflightTimeout";

describe("withRemotePreflightTimeout", () => {
  it("resolves when the preflight completes before the timeout", async () => {
    await expect(
      withRemotePreflightTimeout(Promise.resolve("ok"), 100)
    ).resolves.toBe("ok");
  });

  it("rejects with a readable timeout message when preflight never returns", async () => {
    vi.useFakeTimers();
    try {
      const pending = withRemotePreflightTimeout(new Promise(() => {}), 1000);
      const assertion = expect(pending).rejects.toThrow(
        remotePreflightTimeoutMessage(1000)
      );
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
