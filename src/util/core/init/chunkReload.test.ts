import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetChunkRecoveryForTests,
  isChunkLoadError,
  markChunkRecoveryRuntimeReady,
  recoverFromChunkLoadFailure,
} from "./chunkReload";

const STARTUP_RELOAD_COUNT_KEY = "orgii:chunk-reload-count";
const RUNTIME_RELOAD_STATE_KEY = "orgii:chunk-reload-state:runtime";

let reloadSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  __resetChunkRecoveryForTests();
  reloadSpy = vi.fn();
  Object.defineProperty(window, "location", {
    value: { reload: reloadSpy },
    configurable: true,
    writable: true,
  });
  delete (window as unknown as Record<string, unknown>)
    .__ORGII_SHOW_STARTUP_ERROR__;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)
    .__ORGII_SHOW_STARTUP_ERROR__;
  vi.restoreAllMocks();
});

describe("isChunkLoadError", () => {
  it.each([
    new Error("Loading chunk file failed"),
    new Error("ChunkLoadError while loading editor"),
    new TypeError("Failed to fetch dynamically imported module"),
    Object.assign(new Error("network failure"), { name: "ChunkLoadError" }),
    { error: new Error("Loading chunk nested failed") },
    { reason: new Error("Loading chunk rejected") },
  ])("recognizes every supported chunk signature", (error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("does not infer a chunk failure merely from a vendor filename", () => {
    expect(
      isChunkLoadError({
        message: "Cannot read properties of undefined",
        filename: "/vendors-node_modules.js",
      })
    ).toBe(false);
  });

  it("does not recurse forever through cyclic error wrappers", () => {
    const cyclic: { error?: unknown } = {};
    cyclic.error = cyclic;

    expect(isChunkLoadError(cyclic)).toBe(false);
  });
});

describe("recoverFromChunkLoadFailure", () => {
  it("bounds startup reloads and then shows the startup panel", () => {
    const panel = vi.fn();
    (
      window as unknown as { __ORGII_SHOW_STARTUP_ERROR__?: () => void }
    ).__ORGII_SHOW_STARTUP_ERROR__ = panel;
    const failure = new Error("Loading chunk startup failed");

    recoverFromChunkLoadFailure({ failure });
    recoverFromChunkLoadFailure({ failure });
    recoverFromChunkLoadFailure({ failure });

    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem(STARTUP_RELOAD_COUNT_KEY)).toBe("2");
    expect(panel).toHaveBeenCalledTimes(1);
  });

  it("switches auto recovery to the runtime budget after first paint", () => {
    sessionStorage.setItem(STARTUP_RELOAD_COUNT_KEY, "2");
    markChunkRecoveryRuntimeReady();
    const onGiveUp = vi.fn();
    const failure = new Error("Loading chunk file failed");

    recoverFromChunkLoadFailure({ failure, onGiveUp });
    recoverFromChunkLoadFailure({ failure, onGiveUp });

    expect(sessionStorage.getItem(STARTUP_RELOAD_COUNT_KEY)).toBeNull();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("allows one independent later failure without forgetting the first", () => {
    markChunkRecoveryRuntimeReady();
    const onGiveUp = vi.fn();
    const firstFailure = new Error("Loading chunk file failed");

    recoverFromChunkLoadFailure({
      failure: firstFailure,
      onGiveUp,
    });
    recoverFromChunkLoadFailure({
      failure: new Error("Loading chunk directory failed"),
      onGiveUp,
    });
    recoverFromChunkLoadFailure({ failure: firstFailure, onGiveUp });

    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("bounds the total runtime budget across different failures", () => {
    markChunkRecoveryRuntimeReady();
    const onGiveUp = vi.fn();

    for (const label of ["file", "directory", "terminal"]) {
      recoverFromChunkLoadFailure({
        failure: new Error(`Loading chunk ${label} failed`),
        onGiveUp,
      });
    }

    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("uses a failed asset URL as the runtime failure identity", () => {
    markChunkRecoveryRuntimeReady();
    const onGiveUp = vi.fn();
    const failure = { target: { src: "http://localhost/file.js" } };

    recoverFromChunkLoadFailure({ failure, onGiveUp });
    recoverFromChunkLoadFailure({ failure, onGiveUp });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RUNTIME_RELOAD_STATE_KEY)).toContain(
      "http://localhost/file.js"
    );
  });

  it("fails closed when the reload budget cannot be persisted", () => {
    const onGiveUp = vi.fn();
    vi.spyOn(sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    recoverFromChunkLoadFailure({
      failure: new Error("Loading chunk storage failed"),
      onGiveUp,
    });

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the reload budget cannot be read", () => {
    const onGiveUp = vi.fn();
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    recoverFromChunkLoadFailure({
      failure: new Error("Loading chunk storage failed"),
      onGiveUp,
    });

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });
});

describe("automatic reload ownership", () => {
  it.each([
    "src/index.tsx",
    "src/components/ErrorBoundary/index.tsx",
    "src/modules/WorkStation/TabContent/TabErrorBoundary.tsx",
  ])("%s has no direct automatic reload", (relativePath) => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../..", relativePath),
      "utf8"
    );
    expect(source).not.toMatch(/window\.location\.reload\(\)\s*;/);
  });

  it.each([
    "src/index.tsx",
    "src/components/ErrorBoundary/index.tsx",
    "src/modules/WorkStation/TabContent/TabErrorBoundary.tsx",
    "src/modules/shared/Error/index.tsx",
  ])(
    "%s delegates chunk classification to the canonical helper",
    (relativePath) => {
      const source = readFileSync(
        path.resolve(__dirname, "../../../..", relativePath),
        "utf8"
      );
      expect(source).toContain("isChunkLoadError");
      expect(source).not.toMatch(/\.includes\(["']Loading chunk/);
      expect(source).not.toMatch(/\.includes\(["']ChunkLoadError/);
    }
  );
});
