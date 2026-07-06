/**
 * Terminal Output Scheduler
 *
 * Deep performance architecture:
 *
 * 1. MessageChannel work loop (not RAF/setTimeout) — yields to the browser's
 *    task scheduler between chunks with ~0ms latency instead of RAF's 4ms
 *    clamping floor. User input events preempt the work loop naturally because
 *    the channel posts a new macrotask, which sits in the task queue behind any
 *    pending input tasks.
 *
 * 2. ANSI-aware chunking — the chunk splitter parses escape sequences so chunk
 *    boundaries always fall between complete sequences. A mid-sequence split
 *    corrupts colour/cursor state in xterm (e.g. splitting ESC[33m leaves a
 *    partial CSI open).
 *
 * 3. Adaptive chunk sizing — measures wall-clock render time for each
 *    terminal.write() call and adjusts the per-chunk byte cap:
 *    - renderMs > 8ms  → halve chunk size (down to MIN_CHUNK_SIZE)
 *    - renderMs < 2ms  for 5 consecutive frames → double it (up to MAX_CHUNK_SIZE)
 *    This keeps frame time near 6–8ms regardless of terminal width/content.
 *
 * 4. Telemetry ACK — ack_pty_data carries { sessionId, byteCount, queueDepth,
 *    renderMs } so Rust can adaptively throttle at the PTY-reader level instead
 *    of just using a fixed watermark.
 *
 * 5. Background pane isolation — background panes use a separate MessageChannel
 *    with a 50ms coalescing timer, so their work loop never steals time slices
 *    from the foreground pane.
 */
import { createLogger } from "@src/hooks/logger";
import { invokeTauri, isTauriReady } from "@src/util/platform/tauri/init";

const log = createLogger("TerminalOutputScheduler");

// ============================================
// Constants
// ============================================

/** Initial chunk size — scheduler adapts from here. */
const INITIAL_CHUNK_SIZE = 16 * 1024; // 16 KB

/** Minimum chunk size under heavy render load. */
const MIN_CHUNK_SIZE = 2 * 1024; // 2 KB

/** Maximum chunk size when renders are very fast. */
const MAX_CHUNK_SIZE = 64 * 1024; // 64 KB

/** Max foreground writes per work-loop turn. */
const FOREGROUND_WRITES_PER_TURN = 2;

/** Background drain interval in ms (coalescing timer). */
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

/**
 * Adaptive sizing thresholds.
 * Halve chunk size when a single write exceeds this.
 */
const ADAPT_SHRINK_THRESHOLD_MS = 8;
/** Grow chunk size after this many consecutive fast frames. */
const ADAPT_GROW_THRESHOLD_MS = 2;
const ADAPT_GROW_CONSECUTIVE_FRAMES = 5;

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
  /** MessageChannel port used for foreground work-loop posts. */
  mcPort: MessagePort | null;
  /** Whether a work-loop turn is already posted on the channel. */
  mcPending: boolean;
  /** Timer handle for background drain coalescing. */
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
  /** Current adaptive chunk size for this pane. */
  chunkSize: number;
  /** Consecutive frames where renderMs was below ADAPT_GROW_THRESHOLD_MS. */
  fastFrameStreak: number;
  /** Last measured render time in ms (for telemetry). */
  lastRenderMs: number;
}

// ============================================
// ANSI sequence state machine
// ============================================

/**
 * Returns the length of a complete ANSI/VT escape sequence starting at
 * position `pos` in `s`, or 0 if the character at `pos` is not ESC.
 *
 * Handles:
 *   ESC [ ... final    (CSI — parameter bytes 0x30-0x3F, intermediate 0x20-0x2F, final 0x40-0x7E)
 *   ESC ] ... BEL/ST   (OSC — terminated by BEL \x07 or ESC \)
 *   ESC ( / ) / * / +  (Designate character set — 2-char)
 *   ESC # digit        (DEC private — 3-char)
 *   ESC P ... ST       (DCS — terminated by ST)
 *   ESC _              (APC)
 *   ESC ^              (PM)
 *   ESC X              (SOS)
 *   ESC c / ESC =, etc.(2-char sequences)
 *
 * Returns 0 if `s[pos] !== ESC` or if the sequence is incomplete (not yet
 * terminated) — in which case the caller must not split at this position.
 */
export function ansiSequenceLength(s: string, pos: number): number {
  if (pos >= s.length || s.charCodeAt(pos) !== 0x1b) return 0;

  const next = pos + 1 < s.length ? s.charCodeAt(pos + 1) : -1;
  if (next === -1) return 0; // incomplete — ESC at end of string

  // CSI: ESC [
  if (next === 0x5b) {
    // [
    let i = pos + 2;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return i - pos + 1; // final byte
      i++;
    }
    return 0; // incomplete
  }

  // OSC: ESC ]
  if (next === 0x5d) {
    // ]
    let i = pos + 2;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 0x07) return i - pos + 1; // BEL terminator
      if (c === 0x1b && i + 1 < s.length && s.charCodeAt(i + 1) === 0x5c) {
        // ST = ESC \
        return i - pos + 2;
      }
      i++;
    }
    return 0; // incomplete
  }

  // DCS: ESC P / APC: ESC _ / PM: ESC ^ / SOS: ESC X  — all ST-terminated
  if (
    next === 0x50 || // P
    next === 0x5f || // _
    next === 0x5e || // ^
    next === 0x58 // X
  ) {
    let i = pos + 2;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 0x1b && i + 1 < s.length && s.charCodeAt(i + 1) === 0x5c) {
        return i - pos + 2;
      }
      i++;
    }
    return 0; // incomplete
  }

  // Designate character set: ESC ( / ) / * / + — followed by one char
  if (
    next === 0x28 || // (
    next === 0x29 || // )
    next === 0x2a || // *
    next === 0x2b // +
  ) {
    return pos + 2 < s.length ? 3 : 0;
  }

  // DEC private: ESC # digit
  if (next === 0x23) {
    // #
    return pos + 2 < s.length ? 3 : 0;
  }

  // Everything else: 2-char sequence (ESC c, ESC =, ESC >, ESC 7/8, …)
  return 2;
}

/**
 * Find a safe chunk boundary in `s` at or before `targetPos` such that no
 * ANSI escape sequence is split.
 *
 * The algorithm scans forward from the start of `s`, tracking sequence extents.
 * A candidate split point is "safe" when it falls between sequences (or between
 * plain-text characters) and does not land inside a UTF-16 surrogate pair.
 *
 * Returns the byte offset of the last safe split ≤ targetPos, or 0 if none found.
 */
export function findAnsiSafeSplit(s: string, targetPos: number): number {
  if (targetPos >= s.length) return s.length;
  if (targetPos <= 0) return 0;

  let i = 0;
  let lastSafe = 0;

  while (i < targetPos) {
    const c = s.charCodeAt(i);

    if (c === 0x1b) {
      // ESC — measure sequence
      const seqLen = ansiSequenceLength(s, i);
      if (seqLen === 0) {
        // Incomplete sequence — cannot split anywhere past here safely.
        // Return the last safe position before this ESC.
        return lastSafe;
      }
      const seqEnd = i + seqLen;
      if (seqEnd <= targetPos) {
        i = seqEnd;
        lastSafe = i; // safe to split immediately after a complete sequence
      } else {
        // Sequence crosses targetPos — back up to lastSafe
        return lastSafe;
      }
    } else {
      // Plain character — check for UTF-16 surrogate pairs
      if ((c & 0xfc00) === 0xd800 && i + 1 < s.length) {
        // High surrogate — must include the following low surrogate
        i += 2;
      } else {
        i += 1;
      }
      if (i <= targetPos) {
        lastSafe = i;
      }
    }
  }

  return lastSafe;
}

// ============================================
// Scheduler registry (module-level singleton map)
// ============================================

const paneMap = new Map<string, PaneScheduler>();

// ============================================
// MessageChannel work loop
// ============================================

/**
 * Create a MessageChannel-backed scheduler port for a pane.
 *
 * Why MessageChannel and not requestAnimationFrame?
 *
 * RAF has a 4ms clamping floor in background tabs (Chromium) and fires at most
 * once per vsync (~16ms). Between two RAF callbacks a flood of PTY output can
 * accumulate 30–60 KB that xterm then renders in one synchronous burst, causing
 * a visible hitch.
 *
 * MessageChannel posts a macrotask that the browser schedules cooperatively at
 * ~0ms — it will be preempted by pending user-input events (which sit in the
 * same task queue) so interactive keystrokes are never delayed by a drain turn.
 * We still self-throttle to FOREGROUND_WRITES_PER_TURN writes per turn to
 * avoid starving other JS work.
 */
function createMessageChannelPort(pane: PaneScheduler): MessagePort {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    pane.mcPending = false;
    drainForegroundTurn(pane);
  };
  channel.port1.start();
  return channel.port2; // caller posts to port2 to trigger port1
}

function postWorkTurn(pane: PaneScheduler) {
  if (pane.mcPending) return;
  if (!pane.mcPort) {
    pane.mcPort = createMessageChannelPort(pane);
  }
  pane.mcPending = true;
  pane.mcPort.postMessage(null);
}

// ============================================
// Adaptive chunk sizing
// ============================================

function adaptChunkSize(pane: PaneScheduler, renderMs: number) {
  pane.lastRenderMs = renderMs;

  if (renderMs > ADAPT_SHRINK_THRESHOLD_MS) {
    // Slow render — halve chunk size immediately
    pane.chunkSize = Math.max(MIN_CHUNK_SIZE, pane.chunkSize >> 1);
    pane.fastFrameStreak = 0;
  } else if (renderMs < ADAPT_GROW_THRESHOLD_MS) {
    pane.fastFrameStreak++;
    if (pane.fastFrameStreak >= ADAPT_GROW_CONSECUTIVE_FRAMES) {
      pane.chunkSize = Math.min(MAX_CHUNK_SIZE, pane.chunkSize << 1);
      pane.fastFrameStreak = 0;
    }
  } else {
    // Medium range — reset streak so we don't grow prematurely
    pane.fastFrameStreak = 0;
  }
}

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
      mcPort: null,
      mcPending: false,
      timerId: null,
      pendingAckBytes: 0,
      ackScheduled: false,
      lastInputAt: 0,
      bypassBudgetUsed: 0,
      bypassWindowStart: 0,
      chunkSize: INITIAL_CHUNK_SIZE,
      fastFrameStreak: 0,
      lastRenderMs: 0,
    };
    paneMap.set(sessionId, pane);
  } else {
    pane.write = write;
  }
  return pane;
}

function scheduleAck(pane: PaneScheduler) {
  if (pane.ackScheduled || pane.pendingAckBytes === 0) return;
  pane.ackScheduled = true;
  // Schedule ACK as a microtask so it goes out after the current write batch
  // but before the next macrotask (keepin latency low).
  queueMicrotask(() => {
    flushAck(pane);
  });
}

function flushAck(pane: PaneScheduler) {
  if (pane.pendingAckBytes > 0 && isTauriReady()) {
    invokeTauri("ack_pty_data", {
      sessionId: pane.sessionId,
      byteCount: pane.pendingAckBytes,
      queueDepth: pane.queueByteLength,
      renderMs: Math.round(pane.lastRenderMs),
    }).catch(() => undefined);
    pane.pendingAckBytes = 0;
  }
  pane.ackScheduled = false;
}

/**
 * Consume up to `chunkSize` bytes from the front of the queue,
 * respecting ANSI sequence boundaries.
 *
 * Returns null if queue is empty.
 */
function consumeChunk(pane: PaneScheduler): string | null {
  if (pane.queue.length === 0) return null;

  const entry = pane.queue[0];
  const chunkSize = pane.chunkSize;

  if (entry.data.length <= chunkSize) {
    pane.queue.shift();
    pane.queueByteLength -= entry.byteLength;
    pane.pendingAckBytes += entry.byteLength;
    return entry.data;
  }

  // Find a safe split point that respects ANSI sequences and surrogate pairs
  const splitAt = findAnsiSafeSplit(entry.data, chunkSize);

  if (splitAt === 0) {
    // Edge case: the sequence starting at byte 0 is longer than chunkSize.
    // We must emit the entire entry to avoid splitting mid-sequence. This
    // temporarily exceeds chunk budget but is the only correct option.
    pane.queue.shift();
    pane.queueByteLength -= entry.byteLength;
    pane.pendingAckBytes += entry.byteLength;
    return entry.data;
  }

  const chunk = entry.data.slice(0, splitAt);
  entry.data = entry.data.slice(splitAt);

  // Proportional byte accounting (approximate — byte length isn't chars for non-ASCII)
  const totalChars = splitAt + entry.data.length;
  const chunkBytes =
    totalChars > 0
      ? Math.round((splitAt / totalChars) * entry.byteLength)
      : entry.byteLength;

  entry.byteLength -= chunkBytes;
  pane.queueByteLength -= chunkBytes;
  pane.pendingAckBytes += chunkBytes;
  return chunk;
}

/**
 * Write a chunk and measure wall-clock render time to feed adaptive sizing.
 */
function writeAndMeasure(pane: PaneScheduler, chunk: string) {
  const t0 = performance.now();
  pane.write(chunk);
  const renderMs = performance.now() - t0;
  adaptChunkSize(pane, renderMs);
}

function drainForegroundTurn(pane: PaneScheduler) {
  if (!pane.foreground || pane.queue.length === 0) return;

  for (
    let i = 0;
    i < FOREGROUND_WRITES_PER_TURN && pane.queue.length > 0;
    i++
  ) {
    const chunk = consumeChunk(pane);
    if (chunk !== null) {
      writeAndMeasure(pane, chunk);
    }
  }
  scheduleAck(pane);

  if (pane.queue.length > 0) {
    postWorkTurn(pane); // schedule next turn
  }
}

function drainBackground(pane: PaneScheduler) {
  pane.timerId = null;
  if (pane.queue.length === 0) return;

  const deadline = performance.now() + BACKGROUND_TIME_BUDGET_MS;
  while (pane.queue.length > 0 && performance.now() < deadline) {
    const chunk = consumeChunk(pane);
    if (chunk !== null) {
      pane.write(chunk); // no measurement for background panes — saves CPU
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
    postWorkTurn(pane);
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

  if (pane.mcPort) {
    pane.mcPort.close();
    pane.mcPort = null;
  }
  if (pane.timerId !== null) {
    clearTimeout(pane.timerId);
  }
  paneMap.delete(sessionId);
}

/**
 * Set whether this pane is in the foreground (active/visible) or background.
 * Foreground panes drain on MessageChannel work loop; background on 50ms timer.
 */
export function setPaneForeground(
  sessionId: string,
  foreground: boolean
): void {
  const pane = paneMap.get(sessionId);
  if (!pane || pane.foreground === foreground) return;

  pane.foreground = foreground;

  if (foreground) {
    // Cancel background timer and switch to work-loop drain
    if (pane.timerId !== null) {
      clearTimeout(pane.timerId);
      pane.timerId = null;
    }
    if (pane.queue.length > 0) {
      postWorkTurn(pane);
    }
  } else {
    // Tear down MessageChannel work loop; switch to timer drain
    if (pane.mcPort) {
      pane.mcPort.close();
      pane.mcPort = null;
    }
    pane.mcPending = false;
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

  // Use pendingAckBytes as the byte-written counter — consumeChunk already
  // increments it by the stored byteLength of each entry, avoiding a
  // TextEncoder allocation per chunk.
  const bytesBeforeFlush = pane.pendingAckBytes;
  while (pane.queue.length > 0) {
    const written = pane.pendingAckBytes - bytesBeforeFlush;
    if (written >= maxBytes) break;
    const chunk = consumeChunk(pane);
    if (chunk !== null) {
      pane.write(chunk);
    }
  }
  scheduleAck(pane);
  return pane.pendingAckBytes - bytesBeforeFlush;
}

/**
 * Returns the current backlog byte length for a pane (for diagnostics).
 */
export function getBacklogBytes(sessionId: string): number {
  return paneMap.get(sessionId)?.queueByteLength ?? 0;
}

/**
 * Returns the current adaptive chunk size for a pane (for diagnostics/tests).
 */
export function getChunkSize(sessionId: string): number {
  return paneMap.get(sessionId)?.chunkSize ?? INITIAL_CHUNK_SIZE;
}

/**
 * Returns the last measured render time in ms for a pane (for diagnostics/tests).
 */
export function getLastRenderMs(sessionId: string): number {
  return paneMap.get(sessionId)?.lastRenderMs ?? 0;
}

/**
 * Apply a render-time measurement to a pane's adaptive sizing state directly.
 * Only intended for unit tests — allows testing chunk size adaptation without
 * needing to fake `performance.now()` timing through the write path.
 */
export function _testApplyRenderMs(sessionId: string, renderMs: number): void {
  const pane = paneMap.get(sessionId);
  if (!pane) return;
  adaptChunkSize(pane, renderMs);
}

// ============================================
// Exported constants for tests
// ============================================
export {
  INITIAL_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  FOREGROUND_WRITES_PER_TURN,
  BACKGROUND_DRAIN_INTERVAL_MS,
  BACKGROUND_TIME_BUDGET_MS,
  HIDDEN_BACKLOG_CAP,
  INTERACTIVE_WINDOW_MS,
  INTERACTIVE_BYPASS_SIZE_HARD,
  INTERACTIVE_BYPASS_SIZE_ANSI,
  INTERACTIVE_BYPASS_BUDGET,
  ADAPT_SHRINK_THRESHOLD_MS,
  ADAPT_GROW_THRESHOLD_MS,
  ADAPT_GROW_CONSECUTIVE_FRAMES,
};
