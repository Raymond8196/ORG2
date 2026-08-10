import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runNativeMenuSingleFlight } from "./nativeMenuSingleFlight";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("runNativeMenuSingleFlight", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("drops a concurrent request before invoking its menu factory", async () => {
    const firstRun = deferred<void>();
    const firstTask = vi.fn(() => firstRun.promise);
    const duplicateTask = vi.fn(async () => undefined);

    const firstResultPromise = runNativeMenuSingleFlight(
      "file-explorer",
      firstTask
    );
    const duplicateResult = await runNativeMenuSingleFlight(
      "tab-context-menu",
      duplicateTask
    );

    expect(firstTask).toHaveBeenCalledOnce();
    expect(duplicateTask).not.toHaveBeenCalled();
    expect(duplicateResult).toEqual({
      status: "busy",
      activeSource: "file-explorer",
    });

    firstRun.resolve();
    await expect(firstResultPromise).resolves.toEqual({
      status: "completed",
      value: undefined,
    });
  });

  it("accepts a new request after the active popup completes", async () => {
    const firstRun = deferred<void>();
    const firstResultPromise = runNativeMenuSingleFlight(
      "first-menu",
      () => firstRun.promise
    );
    firstRun.resolve();
    await firstResultPromise;

    const nextTask = vi.fn(async () => "opened");
    await expect(
      runNativeMenuSingleFlight("next-menu", nextTask)
    ).resolves.toEqual({ status: "completed", value: "opened" });
    expect(nextTask).toHaveBeenCalledOnce();
  });

  it("releases the gate when menu construction or popup rejects", async () => {
    const failure = new Error("popup failed");

    await expect(
      runNativeMenuSingleFlight("broken-menu", async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    await expect(
      runNativeMenuSingleFlight("recovery-menu", async () => "recovered")
    ).resolves.toEqual({ status: "completed", value: "recovered" });
  });

  it("shares the active gate across hot module reloads", async () => {
    const activeRun = deferred<void>();
    const firstResultPromise = runNativeMenuSingleFlight(
      "pre-reload-menu",
      () => activeRun.promise
    );

    vi.resetModules();
    const reloadedModule = await import("./nativeMenuSingleFlight");
    const reloadedTask = vi.fn(async () => undefined);
    await expect(
      reloadedModule.runNativeMenuSingleFlight("post-reload-menu", reloadedTask)
    ).resolves.toEqual({
      status: "busy",
      activeSource: "pre-reload-menu",
    });
    expect(reloadedTask).not.toHaveBeenCalled();

    activeRun.resolve();
    await firstResultPromise;
  });

  it("keeps every native popup entry point behind the coordinator", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const unguardedFiles = listSourceFiles(sourceRoot)
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("@tauri-apps/api/menu") &&
          /\.popup\s*\(/.test(source) &&
          !source.includes("runNativeMenuSingleFlight")
        );
      })
      .map((file) => path.relative(sourceRoot, file));

    expect(unguardedFiles).toEqual([]);
  });
});
