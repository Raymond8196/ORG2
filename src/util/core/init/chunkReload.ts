/**
 * Single owner for automatic chunk-failure recovery.
 *
 * Every automatic reload caused by a failed script/style/dynamic import must
 * pass through this module. Keeping classification and the reload budget here
 * prevents parallel window/error-boundary handlers from drifting or bypassing
 * the circuit breaker.
 */

const STARTUP_RELOAD_COUNT_KEY = "orgii:chunk-reload-count";
const RUNTIME_RELOAD_STATE_KEY = "orgii:chunk-reload-state:runtime";
const STARTUP_RELOAD_CAP = 2;
const RUNTIME_RELOAD_CAP_PER_FAILURE = 1;
const RUNTIME_RELOAD_CAP_TOTAL = 2;
const MAX_FAILURE_FINGERPRINT_LENGTH = 512;

type RecoverySurface = "auto" | "startup" | "runtime";
type GiveUpFn = () => void;

interface RuntimeFailureBudget {
  fingerprint: string;
  count: number;
}

interface RuntimeReloadState {
  totalCount: number;
  failures: RuntimeFailureBudget[];
}

export interface ChunkRecoveryOptions {
  /** The error, rejection, ErrorEvent, or failed DOM resource being recovered. */
  failure: unknown;
  /** React callers use runtime; early window handlers use auto. */
  surface?: RecoverySurface;
  /** Render the owning error surface when the reload budget is unavailable. */
  onGiveUp?: GiveUpFn;
}

let runtimeReady = false;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function errorNameAndMessage(
  value: unknown,
  seen = new WeakSet<object>()
): {
  name: string;
  message: string;
} {
  if (typeof value === "string") {
    return { name: "", message: value };
  }

  const record = asRecord(value);
  if (!record) {
    return { name: "", message: "" };
  }
  if (seen.has(record)) {
    return { name: "", message: "" };
  }
  seen.add(record);

  const nested = record.error ?? record.reason;
  if (nested !== undefined && nested !== value) {
    const nestedError = errorNameAndMessage(nested, seen);
    if (nestedError.name || nestedError.message) {
      return nestedError;
    }
  }

  return {
    name: typeof record.name === "string" ? record.name : "",
    message: typeof record.message === "string" ? record.message : "",
  };
}

/** Canonical classifier shared by startup, React, and tab error boundaries. */
export function isChunkLoadError(value: unknown): boolean {
  const { name, message } = errorNameAndMessage(value);
  return (
    name === "ChunkLoadError" ||
    message.includes("ChunkLoadError") ||
    message.includes("Loading chunk") ||
    message.includes("dynamically imported module")
  );
}

function failedResourceUrl(value: unknown): string {
  const record = asRecord(value);
  const target = asRecord(record?.target ?? value);
  if (!target) return "";

  if (typeof target.src === "string" && target.src) return target.src;
  if (typeof target.href === "string" && target.href) return target.href;
  return "";
}

function failureFingerprint(value: unknown): string {
  const resourceUrl = failedResourceUrl(value);
  if (resourceUrl) {
    return `asset:${resourceUrl}`.slice(0, MAX_FAILURE_FINGERPRINT_LENGTH);
  }

  const { name, message } = errorNameAndMessage(value);
  const fingerprint = `${name}:${message}`.trim();
  return (fingerprint === ":" ? "unknown-chunk-failure" : fingerprint).slice(
    0,
    MAX_FAILURE_FINGERPRINT_LENGTH
  );
}

function readStartupCount(): number | null {
  try {
    const parsed = Number.parseInt(
      sessionStorage.getItem(STARTUP_RELOAD_COUNT_KEY) || "0",
      10
    );
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    // Without a readable counter, a reload cannot be bounded across documents.
    return null;
  }
}

function readRuntimeState(): RuntimeReloadState | null | undefined {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(RUNTIME_RELOAD_STATE_KEY);
  } catch {
    // `undefined` distinguishes inaccessible storage from absent/corrupt state.
    return undefined;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeReloadState> &
      Partial<RuntimeFailureBudget>;

    // Migrate the single-fingerprint shape used by early development builds.
    if (
      typeof parsed.fingerprint === "string" &&
      typeof parsed.count === "number" &&
      Number.isInteger(parsed.count) &&
      parsed.count >= 0
    ) {
      return {
        totalCount: parsed.count,
        failures: [{ fingerprint: parsed.fingerprint, count: parsed.count }],
      };
    }

    if (
      typeof parsed.totalCount !== "number" ||
      !Number.isInteger(parsed.totalCount) ||
      parsed.totalCount < 0 ||
      !Array.isArray(parsed.failures)
    ) {
      return null;
    }

    const failures = parsed.failures.filter(
      (entry): entry is RuntimeFailureBudget =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Partial<RuntimeFailureBudget>).fingerprint ===
          "string" &&
        typeof (entry as Partial<RuntimeFailureBudget>).count === "number" &&
        Number.isInteger((entry as Partial<RuntimeFailureBudget>).count) &&
        (entry as Partial<RuntimeFailureBudget>).count! >= 0
    );
    if (failures.length !== parsed.failures.length) return null;

    return { totalCount: parsed.totalCount, failures };
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    // Without persisted state a reload cannot be bounded across documents.
    return false;
  }
}

function showGiveUp(
  surface: Exclude<RecoverySurface, "auto">,
  onGiveUp?: GiveUpFn
): void {
  if (surface === "startup") {
    const showStartupError = (
      window as unknown as { __ORGII_SHOW_STARTUP_ERROR__?: GiveUpFn }
    ).__ORGII_SHOW_STARTUP_ERROR__;
    if (typeof showStartupError === "function") {
      showStartupError();
      return;
    }
  }
  onGiveUp?.();
}

/**
 * Spend the applicable recovery budget and reload exactly once.
 *
 * Runtime state has both per-failure and session-wide caps. The fingerprint
 * cap stops A/B/A failures from resetting one another, while the total cap
 * prevents a sequence of different unavailable chunks from reloading forever.
 */
export function recoverFromChunkLoadFailure({
  failure,
  surface = "auto",
  onGiveUp,
}: ChunkRecoveryOptions): void {
  const resolvedSurface =
    surface === "auto" ? (runtimeReady ? "runtime" : "startup") : surface;

  let canReload = false;
  if (resolvedSurface === "startup") {
    const count = readStartupCount();
    if (count === null) {
      showGiveUp(resolvedSurface, onGiveUp);
      return;
    }
    if (count >= STARTUP_RELOAD_CAP) {
      showGiveUp(resolvedSurface, onGiveUp);
      return;
    }
    canReload = writeStorage(STARTUP_RELOAD_COUNT_KEY, String(count + 1));
  } else {
    const fingerprint = failureFingerprint(failure);
    const storedState = readRuntimeState();
    if (storedState === undefined) {
      showGiveUp(resolvedSurface, onGiveUp);
      return;
    }
    const previous = storedState ?? { totalCount: 0, failures: [] };
    const failureCount =
      previous.failures.find((entry) => entry.fingerprint === fingerprint)
        ?.count ?? 0;
    if (
      failureCount >= RUNTIME_RELOAD_CAP_PER_FAILURE ||
      previous.totalCount >= RUNTIME_RELOAD_CAP_TOTAL
    ) {
      showGiveUp(resolvedSurface, onGiveUp);
      return;
    }

    const nextFailures = previous.failures.some(
      (entry) => entry.fingerprint === fingerprint
    )
      ? previous.failures.map((entry) =>
          entry.fingerprint === fingerprint
            ? { ...entry, count: entry.count + 1 }
            : entry
        )
      : [...previous.failures, { fingerprint, count: 1 }];
    canReload = writeStorage(
      RUNTIME_RELOAD_STATE_KEY,
      JSON.stringify({
        totalCount: previous.totalCount + 1,
        failures: nextFailures,
      } satisfies RuntimeReloadState)
    );
  }

  if (!canReload) {
    showGiveUp(resolvedSurface, onGiveUp);
    return;
  }

  // The sole automatic chunk-recovery reload exit in application code.
  window.location.reload();
}

/** Mark React as renderable and restore only the pre-paint startup budget. */
export function markChunkRecoveryRuntimeReady(): void {
  runtimeReady = true;
  try {
    sessionStorage.removeItem(STARTUP_RELOAD_COUNT_KEY);
  } catch {
    // The runtime coordinator will fail closed if a later write is unavailable.
  }
}

/** Test seam for module-local lifecycle state. */
export function __resetChunkRecoveryForTests(): void {
  runtimeReady = false;
}
