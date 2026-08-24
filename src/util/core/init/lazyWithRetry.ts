/**
 * Bounded, retrying dynamic import for lazy chunks.
 *
 * A bare `React.lazy(() => import(...))` has no upper time bound. On Linux
 * WebKitGTK a chunk request can stall without ever completing or erroring
 * (the same class of failure that `WebLoaderStrategy::internallyFailedLoadTimerFired`
 * reports), and the `<Suspense>` fallback then spins forever with no error, no
 * retry, and nothing in the console. `output.chunkLoadTimeout` only covers the
 * script-tag load, and its default is 120s.
 *
 * `public/index.html` already solves exactly this for `main.js` — bounded
 * attempt timeout plus backoff retries — because "a failed script is not
 * retried" on that platform. This module applies the same, proven strategy to
 * every lazy chunk. Webpack's own 8s `output.chunkLoadTimeout` is deliberately
 * shorter than this helper's attempt guard: only webpack can clear its pending
 * `installedChunks` entry so the next import genuinely issues a new request.
 *
 * Note the timeout must be a race, not a `.catch`: the failure mode being
 * defended against is a promise that *never settles*, which no rejection
 * handler can observe.
 */
import { type ComponentType, type LazyExoticComponent, lazy } from "react";

import { createLogger } from "@src/hooks/logger/useLogger";

const log = createLogger("LazyChunk");

/** Backstop above webpack's 8s chunk timeout. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;
/** Total attempts, including the first. */
export const DEFAULT_MAX_ATTEMPTS = 5;

const INITIAL_RETRY_DELAY_MS = 250;
const RETRY_DELAY_MULTIPLIER = 1.5;
const MAX_RETRY_DELAY_MS = 750;

export interface ImportRetryOptions {
  /** Human-readable chunk name, used in logs and the final error message. */
  label?: string;
  attemptTimeoutMs?: number;
  maxAttempts?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reject after `ms` if `promise` has not settled.
 *
 * The rejection handler is attached immediately, so a late rejection from an
 * abandoned attempt is always consumed and never surfaces as an unhandled
 * rejection (which `src/index.tsx` would otherwise treat as a chunk error and
 * reload the page out from under a retry that is still in flight).
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  attempt: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Loading chunk "${label}" timed out after ${ms}ms (attempt ${attempt})`
        )
      );
    }, ms);

    promise.then(
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

function createChunkLoadError(
  label: string,
  attempts: number,
  cause: unknown
): Error {
  // The canonical classifier in `chunkReload.ts` recognizes this name and
  // message, so every recovery surface gives a permanently dead chunk the
  // localized "failed to load component" copy rather than a raw stack.
  const error = new Error(
    `Loading chunk "${label}" failed after ${attempts} attempts`
  );
  error.name = "ChunkLoadError";
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

/**
 * Run `factory` with a per-attempt timeout, retrying with backoff.
 *
 * Retrying re-invokes `import()`. Webpack's shorter chunk timeout settles the
 * pending import and clears `installedChunks` first, so the next attempt
 * genuinely re-issues the network request rather than replaying one promise.
 */
export async function importWithRetry<T>(
  factory: () => Promise<T>,
  options: ImportRetryOptions = {}
): Promise<T> {
  const {
    label = "chunk",
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;

  let delayMs = INITIAL_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await withTimeout(
        factory(),
        attemptTimeoutMs,
        label,
        attempt
      );
      if (attempt > 1) {
        log.info(`Recovered "${label}" on attempt ${attempt}/${maxAttempts}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      log.warn(
        `Attempt ${attempt}/${maxAttempts} for "${label}" failed:`,
        error instanceof Error ? error.message : error
      );

      if (attempt === maxAttempts) break;

      await sleep(delayMs);
      delayMs = Math.min(
        Math.round(delayMs * RETRY_DELAY_MULTIPLIER),
        MAX_RETRY_DELAY_MS
      );
    }
  }

  log.error(`Giving up on "${label}" after ${maxAttempts} attempts`);
  throw createChunkLoadError(label, maxAttempts, lastError);
}

/**
 * Drop-in replacement for `React.lazy` that bounds and retries the import.
 *
 * Caveat inherited from React: a `lazy` component caches its rejection
 * permanently. Once this helper has exhausted its attempts, the only way to try
 * again is to construct a *new* lazy component — resetting an error boundary is
 * not enough. Callers that offer a retry affordance must therefore keep the
 * factory around and rebuild (see `TabContent/rendererComponents.ts`).
 */
export function lazyWithRetry<P>(
  factory: () => Promise<{ default: ComponentType<P> }>,
  options?: ImportRetryOptions
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => importWithRetry(factory, options));
}
