/**
 * Deadline wrapper around the filesystem plugin's `readTextFile`.
 *
 * `readTextFile` takes no timeout and no AbortSignal. A Tauri IPC that never
 * replies therefore leaves `useFileContent`'s `loading` flag pinned to `true`
 * forever. This deadline is an independent defensive bound and diagnostic
 * signal; the observed Linux spinner alone does not prove the filesystem IPC
 * was the layer that stalled.
 *
 * The bound has to be a race, not a `.catch`: the failure mode is a promise
 * that never settles, which no rejection handler can observe.
 */
import { readTextFile } from "@tauri-apps/plugin-fs";

/**
 * Default ceiling for one read.
 *
 * A local read of an ordinary source file completes in single-digit
 * milliseconds, so this is far past any legitimate read while still short
 * enough that the user gets an error with a working Retry button rather than a
 * dead spinner.
 */
export const READ_TIMEOUT_MS = 15_000;

export function createReadTimeoutError(timeoutMs: number): Error {
  // Deliberately colon-free: `classifyFileError` keeps only the text after the
  // last colon when one is present, which would truncate this to a fragment.
  return new Error(
    `Timed out reading the file after ${timeoutMs}ms. The filesystem or the app backend may be unresponsive.`
  );
}

export function withReadTimeout<T>(
  read: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createReadTimeoutError(timeoutMs));
    }, timeoutMs);

    // Attached immediately so a reply arriving after the deadline is consumed
    // rather than surfacing as an unhandled rejection.
    read.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/** `readTextFile` bounded by {@link withReadTimeout}. */
export function readTextFileWithTimeout(
  path: string,
  timeoutMs: number = READ_TIMEOUT_MS
): Promise<string> {
  return withReadTimeout(readTextFile(path), timeoutMs);
}
