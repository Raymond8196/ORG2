/**
 * Terminal Output Scheduler
 *
 * Intercepts all terminal.write() calls and schedules output drain to stay
 * within frame time budgets. Inspired by Orca's renderer-side output scheduler.
 *
 * Architecture:
 * - Foreground pane: up to 2 writes per RAF, 16 KB chunks, low latency
 * - Background pane: 50 ms delay, 16 KB chunks, 8 ms time budget per frame
 * - Hidden backlog cap: 2 MB — oldest data is dropped when exceeded
 * - ACK gate: ackPtyData is called after consuming chunks, not before
 * - Interactive bypass: small packets within 100 ms of user input skip the queue
 */
import { createLogger } from "@src/hooks/logger";
import { invokeTauri, isTauriReady } from "@src/util/platform/tauri/init";

const log = createLogger("TerminalOutputScheduler");

// ============================================
// Constants
// ============================================

/** Maximum bytes written per chunk per drain tick. */
const CHUNK_SIZE = 16 * 1024; // 16 KB

/** Max foreground writes per animation frame. */
const FOREGROUND_WRITES_PER_FRAME = 2;

/** Background drain interval in ms. */
const BACKGROUND_DRAIN_INTERVAL_MS = 50;

/** Time budget per background drain tick (ms). */
const BACKGROUND_TIME_BUDGET_MS = 8;

/** Backlog cap for hidden/background panes. Drop oldest data beyond this. */
const HIDDEN_BACKLOG_CAP = 2 * 1024 * 1024; // 2 MB

/** Interactive bypass: write immediately if data arrives within this many ms of last user input. */
const INTERACTIVE_WINDOW_MS = 100;

/** Interactive bypass: max size for immediate write (hard limit). */
const INTERACTIVE_BYPASS_SIZE_HARD = 1024; // 1 KB

/** Interactive bypass: extended size limit when packet contains ESC/ANSI sequences. */
const INTERACTIVE_BYPASS_SIZE_ANSI = 16 * 1024; // 16 KB

/** Interactive bypass budget: max bytes flushed via fast-path per window. */
const INTERACTIVE_BYPASS_BUDGET = 32 * 1024; // 32 KB per 100 ms window

// ============================================
// Types
// ============================================

type WriteCallback = (data: string | Uint8Array) => void;

interface SchedulerEntry {
  data: string;
  byteLength: number;
}

interface PaneScheduler {
  sessionId: string;
  write: WriteCallback;
  queue: SchedulerEntry[];
  queueByteLength: number;
  foreground: boolean;
  /** RAF handle for foreground drain. */
  rafId: number | null;
  /** Timer handle for background drain. */
  timerId: ReturnType<typeof setTimeout> | null;
  /** Bytes consumed but not yet ACKed. */
  pendingAckBytes: number;
  /** Whether an ACK flush is already scheduled. */
  ackScheduled: boolean;
  /** Timestamp of last user input to this pane (for interactive bypass). */
  lastInputAt: number;
  /** Bytes flushed via interactive bypass within current window. */
  bypassBudgetUsed: number;
  /** Start time of the current 100 ms bypass window. */
  bypassWindowStart: number;
}

// ============================================
// Scheduler registry (module-level singleton map)
// ============================================

const paneMap = new Map<string, PaneScheduler>();

// ============================================
// Internal helpers
// ============================================

function getOrCreate(sessionId: string, write: WriteCallback): PaneScheduler {
  let pane = paneMap.get(sessionId);
  if (!pane) {
    pane = {
      sessionId,
      write,
      queue: [],
      queueByteLength: 0,
      foreground: false,
      rafId: null,
      timerId: null,
      pendingAckBytes: 0,
      ackScheduled: false,
      lastInputAt: 0,
      bypassBudgetUsed: 0,
      bypassWindowStart: 0,
    };
    paneMap.set(sessionId, pane);
  } else {
    // Update write callback in case terminal was recreated.
    pane.write = write;
  }
  return pane;
}

function scheduleAck(pane: PaneScheduler) {
  if (pane.ackScheduled || pane.pendingAckBytes === 0) return;
  pane.ackScheduled = true;
  requestAnimationFrame(() => {
    flushAck(pane);
  });
}

function flushAck(pane: PaneScheduler) {
  if (pane.pendingAckBytes > 0 && isTauriReady()) {
    invokeTauri("ack_pty_data", {
      sessionId: pane.sessionId,
      byteCount: pane.pendingAckBytes,
    }).catch(() => undefined);
    pane.pendingAckBytes = 0;
  }
  pane.ackScheduled = false;
}

function consumeChunk(pane: PaneScheduler): string | null {
  if (pane.queue.length === 0) return null;

  const entry = pane.queue[0];

  if (entry.data.length <= CHUNK_SIZE) {
    pane.queue.shift();
    pane.queueByteLength -= entry.byteLength;
    pane.pendingAckBytes += entry.byteLength;
    return entry.data;
  }

  // Slice off a chunk — find a safe split point (avoid mid-UTF16 surrogate pair)
  let splitAt = CHUNK_SIZE;
  while (
    splitAt > 0 &&
    splitAt < entry.data.length &&
    (entry.data.charCodeAt(splitAt) & 0xfc00) === 0xdc00
  ) {
    splitAt--;
  }

  const chunk = entry.data.slice(0, splitAt);
  entry.data = entry.data.slice(splitAt);
  // Approximate byte-length for the remaining entry
  const chunkBytes = Math.round(
    (splitAt / (splitAt + entry.data.length)) * entry.byteLength
  );
  entry.byteLength -= chunkBytes;
  pane.queueByteLength -= chunkBytes;
  pane.pendingAckBytes += chunkBytes;
  return chunk;
}

function drainForeground(pane: PaneScheduler) {
  pane.rafId = null;
  for (
    let i = 0;
    i < FOREGROUND_WRITES_PER_FRAME && pane.queue.length > 0;
    i++
  ) {
    const chunk = consumeChunk(pane);
    if (chunk !== null) {
      pane.write(chunk);
    }
  }
  scheduleAck(pane);

  if (pane.queue.length > 0) {
    pane.rafId = requestAnimationFrame(() => drainForeground(pane));
  }
}

function drainBackground(pane: PaneScheduler) {
  pane.timerId = null;
  if (pane.queue.length === 0) return;

  const deadline = performance.now() + BACKGROUND_TIME_BUDGET_MS;
  while (pane.queue.length > 0 && performance.now() < deadline) {
    const chunk = consumeChunk(pane);
    if (chunk !== null) {
      pane.write(chunk);
    }
  }
  scheduleAck(pane);

  if (pane.queue.length > 0) {
    pane.timerId = setTimeout(
      () => drainBackground(pane),
      BACKGROUND_DRAIN_INTERVAL_MS
    );
  }
}

function scheduleDrain(pane: PaneScheduler) {
  if (pane.foreground) {
    if (pane.rafId === null) {
      pane.rafId = requestAnimationFrame(() => drainForeground(pane));
    }
  } else {
    if (pane.timerId === null) {
      pane.timerId = setTimeout(
        () => drainBackground(pane),
        BACKGROUND_DRAIN_INTERVAL_MS
      );
    }
  }
}

function enforceBacklogCap(pane: PaneScheduler) {
  if (pane.queueByteLength <= HIDDEN_BACKLOG_CAP) return;

  let dropped = 0;
  while (pane.queue.length > 0 && pane.queueByteLength > HIDDEN_BACKLOG_CAP) {
    const entry = pane.queue.shift()!;
    pane.queueByteLength -= entry.byteLength;
    dropped += entry.byteLength;
  }

  log.warn(
    `[OutputScheduler] Backlog cap exceeded for session ${pane.sessionId}: dropped ${dropped} bytes`
  );

  // Emit a visible warning marker into the terminal
  pane.write(
    "\r\n\x1b[33m[⚠ terminal output dropped: backlog limit reached]\x1b[0m\r\n"
  );
}

function checkInteractiveBypass(
  pane: PaneScheduler,
  data: string,
  byteLength: number
): boolean {
  const now = performance.now();

  // Reset bypass window if needed
  if (now - pane.bypassWindowStart >= INTERACTIVE_WINDOW_MS) {
    pane.bypassWindowStart = now;
    pane.bypassBudgetUsed = 0;
  }

  if (now - pane.lastInputAt >= INTERACTIVE_WINDOW_MS) return false;
  if (pane.bypassBudgetUsed >= INTERACTIVE_BYPASS_BUDGET) return false;

  const containsAnsi = data.includes("\x1b");
  const sizeLimit = containsAnsi
    ? INTERACTIVE_BYPASS_SIZE_ANSI
    : INTERACTIVE_BYPASS_SIZE_HARD;

  if (byteLength > sizeLimit) return false;

  pane.bypassBudgetUsed += byteLength;
  pane.pendingAckBytes += byteLength;
  pane.write(data);
  scheduleAck(pane);
  return true;
}

// ============================================
// Public API
// ============================================

/**
 * Register a pane with the scheduler.
 * Must be called once per terminal session before `scheduleWrite`.
 *
 * @param sessionId - Unique session identifier (matches PTY session ID)
 * @param write     - The actual `terminal.write` function for this pane
 */
export function registerPane(sessionId: string, write: WriteCallback): void {
  getOrCreate(sessionId, write);
}

/**
 * Remove a pane from the scheduler and cancel any pending drain.
 */
export function unregisterPane(sessionId: string): void {
  const pane = paneMap.get(sessionId);
  if (!pane) return;

  if (pane.rafId !== null) {
    cancelAnimationFrame(pane.rafId);
  }
  if (pane.timerId !== null) {
    clearTimeout(pane.timerId);
  }
  paneMap.delete(sessionId);
}

/**
 * Set whether this pane is in the foreground (active/visible) or background.
 * Foreground panes drain on RAF; background panes drain on a 50 ms interval.
 */
export function setPaneForeground(
  sessionId: string,
  foreground: boolean
): void {
  const pane = paneMap.get(sessionId);
  if (!pane || pane.foreground === foreground) return;

  pane.foreground = foreground;

  if (foreground) {
    // Cancel background timer and switch to RAF drain
    if (pane.timerId !== null) {
      clearTimeout(pane.timerId);
      pane.timerId = null;
    }
    if (pane.queue.length > 0 && pane.rafId === null) {
      pane.rafId = requestAnimationFrame(() => drainForeground(pane));
    }
  } else {
    // Cancel RAF and switch to timer drain
    if (pane.rafId !== null) {
      cancelAnimationFrame(pane.rafId);
      pane.rafId = null;
    }
    if (pane.queue.length > 0 && pane.timerId === null) {
      pane.timerId = setTimeout(
        () => drainBackground(pane),
        BACKGROUND_DRAIN_INTERVAL_MS
      );
    }
  }
}

/**
 * Notify the scheduler that the user typed into the given pane.
 * Enables the interactive bypass window for the next 100 ms.
 */
export function notifyUserInput(sessionId: string): void {
  const pane = paneMap.get(sessionId);
  if (!pane) return;
  pane.lastInputAt = performance.now();
}

/**
 * Schedule output to be written to the terminal, applying backpressure and
 * priority rules.
 *
 * @param sessionId  - Target session
 * @param data       - Decoded string data to write
 * @param byteLength - Original byte length (for ACK accounting)
 * @param write      - Fallback write function (used to auto-register if needed)
 */
export function scheduleWrite(
  sessionId: string,
  data: string,
  byteLength: number,
  write: WriteCallback
): void {
  const pane = getOrCreate(sessionId, write);

  // Interactive bypass: go straight to terminal for interactive-feeling output
  if (checkInteractiveBypass(pane, data, byteLength)) {
    return;
  }

  // Enqueue
  pane.queue.push({ data, byteLength });
  pane.queueByteLength += byteLength;

  enforceBacklogCap(pane);
  scheduleDrain(pane);
}

/**
 * Flush up to `maxBytes` of backlog immediately (used on tab show).
 * Returns the number of bytes actually written.
 */
export function flushBacklog(sessionId: string, maxBytes: number): number {
  const pane = paneMap.get(sessionId);
  if (!pane) return 0;

  let written = 0;
  while (pane.queue.length > 0 && written < maxBytes) {
    const chunk = consumeChunk(pane);
    if (chunk !== null) {
      pane.write(chunk);
      written += new TextEncoder().encode(chunk).length;
    }
  }
  scheduleAck(pane);
  return written;
}

/**
 * Returns the current backlog byte length for a pane (for diagnostics).
 */
export function getBacklogBytes(sessionId: string): number {
  return paneMap.get(sessionId)?.queueByteLength ?? 0;
}

// ============================================
// Exported constants for tests
// ============================================
export {
  CHUNK_SIZE,
  FOREGROUND_WRITES_PER_FRAME,
  BACKGROUND_DRAIN_INTERVAL_MS,
  BACKGROUND_TIME_BUDGET_MS,
  HIDDEN_BACKLOG_CAP,
  INTERACTIVE_WINDOW_MS,
  INTERACTIVE_BYPASS_SIZE_HARD,
  INTERACTIVE_BYPASS_SIZE_ANSI,
  INTERACTIVE_BYPASS_BUDGET,
};
