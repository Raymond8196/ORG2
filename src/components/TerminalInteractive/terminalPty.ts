import type { Terminal } from "@xterm/xterm";
import type { MutableRefObject } from "react";

import { createLogger } from "@src/hooks/logger";
import type { ShellType } from "@src/store/ui/editorSettingsAtom";
import {
  invokeTauri,
  isTauriReady,
  listenTauri,
} from "@src/util/platform/tauri/init";
import {
  type PtyOutputPayload,
  ptyPayloadBytes,
} from "@src/util/terminal/ptyOutputPayload";

import { deleteTerminalBuffer, getTerminalBuffer } from "./bufferCache";
import {
  ackBytesWithoutWrite,
  flushBacklog,
  notifyUserInput,
  registerPane,
  resumePane,
  scheduleWrite,
  setPaneForeground,
  suspendPane,
  unregisterPane,
} from "./terminalOutputScheduler";
import type { TerminalViewProps } from "./types";
import { writeBrowserModeMessage } from "./utils";

const log = createLogger("TerminalView");

/**
 * Estimate UTF-8 byte length of a string without a TextEncoder allocation.
 *
 * Terminal output is overwhelmingly ASCII (shell prompts, command output,
 * ANSI sequences). The rare non-ASCII cases (emoji, CJK) over-estimate by
 * at most 3 bytes per character, which is acceptable — byte_count is used
 * as a backpressure hint, not an exact invariant.
 *
 * Implementation: charCode > 0x7F catches all non-ASCII BMP code points; a
 * surrogate pair (charCode > 0x7FF in both high+low halves) is counted as
 * +3 each which approximates the 4-byte UTF-8 encoding of the astral plane.
 */
function estimateByteLength(s: string): number {
  let len = s.length; // start with 1 byte per char (ASCII baseline)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) {
      // Non-ASCII: add extra bytes beyond the already-counted baseline byte.
      // U+0080–U+07FF → 2-byte UTF-8 (+1)
      // U+0800–U+FFFF → 3-byte UTF-8 (+2)
      len += c > 0x7ff ? 2 : 1;
    }
  }
  return len;
}

interface AttachPtyStreamResponse {
  output: string;
  covers_seq: number;
  missed_output: boolean;
  generation?: number;
}

interface PtyConnectionResult {
  coversSeq?: number;
  generation?: number;
}

interface PtyExitPayload {
  generation?: number;
}

interface InitPtyConnectionParams {
  cols: number;
  rows: number;
  sessionKey: string;
  isForeground: boolean;
  terminalRef: MutableRefObject<Terminal | null>;
  sessionIdRef: MutableRefObject<string | null>;
  unlistenOutputRef: MutableRefObject<(() => void) | null>;
  unlistenExitRef: MutableRefObject<(() => void) | null>;
  repoPathRef: MutableRefObject<string | undefined>;
  shellType: ShellType;
  customShellPath?: string;
  shellOverride?: string;
  argsOverride?: string[];
  envOverride?: Record<string, string>;
  nameOverride?: string;
  onSessionInfoReady?: TerminalViewProps["onSessionInfoReady"];
  onPtyCreateRef: MutableRefObject<TerminalViewProps["onPtyCreate"]>;
  onSessionExitRef: MutableRefObject<TerminalViewProps["onSessionExit"]>;
  setIsBrowserMode: (value: boolean) => void;
  setIsConnecting: (value: boolean) => void;
  abortSignal?: AbortSignal;
}

/**
 * Notify the output scheduler that the user typed into the given session.
 * Must be called from the terminal's onData handler to enable interactive bypass.
 */
export function notifyPtyUserInput(sessionId: string): void {
  notifyUserInput(sessionId);
}

function resolvePtyLaunchOptions({
  repoPath,
  shellType,
  customShellPath,
  shellOverride,
}: {
  repoPath?: string;
  shellType: ShellType;
  customShellPath?: string;
  shellOverride?: string;
}) {
  let cwd: string | null = null;
  let shell: string | null = shellOverride || null;

  if (shell) {
    cwd = repoPath || null;
  } else if (shellType === "repo" && repoPath) {
    cwd = repoPath;
  } else if (shellType === "default") {
    cwd = null;
  } else if (shellType === "custom") {
    if (customShellPath) shell = customShellPath;
    cwd = repoPath || null;
  }

  return { cwd, shell };
}

function formatLastLogin(sessionKey: string) {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return `Last login: ${timeStr} on ${sessionKey}`;
}

async function fetchPtyInfo(
  sessionId: string,
  sessionKey: string,
  onSessionInfoReady?: TerminalViewProps["onSessionInfoReady"]
): Promise<number | undefined> {
  try {
    const ptyInfo = await invokeTauri<{
      session_id: string;
      pid: number | null;
      generation?: number;
      shell: string;
      cwd: string | null;
    }>("get_pty_info", {
      sessionId,
    });

    onSessionInfoReady?.({
      sessionKey,
      pid: ptyInfo.pid || undefined,
      generation: ptyInfo.generation,
      shell: ptyInfo.shell,
      cwd: ptyInfo.cwd || undefined,
    });
    return ptyInfo.generation;
  } catch (error) {
    log.error("[TerminalView] Failed to get PTY info:", error);
    return undefined;
  }
}

async function reconnectOrCreatePty({
  cols,
  rows,
  sessionId,
  sessionKey,
  terminal,
  repoPath,
  shellType,
  customShellPath,
  shellOverride,
  argsOverride,
  envOverride,
  nameOverride,
  onSessionInfoReady,
  onPtyCreate,
}: {
  cols: number;
  rows: number;
  sessionId: string;
  sessionKey: string;
  terminal: Terminal;
  repoPath?: string;
  shellType: ShellType;
  customShellPath?: string;
  shellOverride?: string;
  argsOverride?: string[];
  envOverride?: Record<string, string>;
  nameOverride?: string;
  onSessionInfoReady?: TerminalViewProps["onSessionInfoReady"];
  onPtyCreate?: TerminalViewProps["onPtyCreate"];
}) {
  let ptyExists = false;
  try {
    await invokeTauri("resize_pty", {
      request: {
        session_id: sessionId,
        rows: rows || 20,
        cols: cols || 80,
      },
    });
    ptyExists = true;
  } catch {
    ptyExists = false;
  }

  if (!ptyExists) {
    // Clear the previous generation before creating its replacement. Other
    // consumers can then reject any delayed event until get_pty_info returns
    // the new instance identity below.
    onPtyCreate?.(sessionKey);
    terminal.writeln(formatLastLogin(sessionKey));

    const { cwd, shell } = resolvePtyLaunchOptions({
      repoPath,
      shellType,
      customShellPath,
      shellOverride,
    });

    await invokeTauri("create_pty", {
      request: {
        session_id: sessionId,
        rows: rows || 20,
        cols: cols || 80,
        cwd,
        shell,
        args: argsOverride || null,
        env: envOverride || null,
        name: nameOverride || null,
      },
    });

    return {
      generation: await fetchPtyInfo(sessionId, sessionKey, onSessionInfoReady),
    } satisfies PtyConnectionResult;
  }

  // Live session: attach atomically. The backend resumes event emission,
  // resets the flow-control window (fresh listener, no debt — this is what
  // recovers a reader parked on ACKs lost to the previous listener), and
  // returns the restore snapshot plus the stream offset it covers.
  try {
    const attach = await invokeTauri<AttachPtyStreamResponse>(
      "attach_pty_stream",
      { sessionId }
    );

    const cachedBuffer = getTerminalBuffer(sessionId);
    deleteTerminalBuffer(sessionId);
    if (cachedBuffer && !attach.missed_output) {
      // Nothing was produced while detached: the client-side serialized
      // buffer is the richer restore (full scrollback vs bounded snapshot).
      terminal.write(cachedBuffer);
    } else if (attach.output) {
      terminal.write(attach.output);
    }
    // Reconnected PTYs need the same state synchronization as newly created
    // ones. In particular, event consumers outside TerminalView use this
    // generation to reject delayed events from a previous PTY instance.
    const infoGeneration = await fetchPtyInfo(
      sessionId,
      sessionKey,
      onSessionInfoReady
    );
    return {
      coversSeq: attach.covers_seq,
      generation: infoGeneration ?? attach.generation,
    } satisfies PtyConnectionResult;
  } catch (error) {
    // Backend without attach_pty_stream (hot-reload version skew) — legacy
    // restore: client buffer if present, else bounded snapshot + window resync.
    log.warn(
      "[TerminalView] attach_pty_stream unavailable, using legacy restore:",
      error
    );

    const cachedBuffer = getTerminalBuffer(sessionId);
    if (cachedBuffer) {
      terminal.write(cachedBuffer);
      deleteTerminalBuffer(sessionId);
      return {} satisfies PtyConnectionResult;
    }

    try {
      const snapshot = await invokeTauri<{
        output: string;
        unacked_bytes?: number;
      }>("get_pty_output_snapshot", { sessionId });

      if (snapshot.output) {
        terminal.write(snapshot.output);
      }
      if (snapshot.unacked_bytes && snapshot.unacked_bytes > 0) {
        await invokeTauri("ack_pty_data", {
          sessionId,
          byteCount: snapshot.unacked_bytes,
        });
      }
    } catch (snapshotError) {
      log.error(
        "[TerminalView] Failed to restore PTY output snapshot:",
        snapshotError
      );
    }
    return {} satisfies PtyConnectionResult;
  }
}

export async function initPtyConnection({
  cols,
  rows,
  sessionKey,
  isForeground,
  terminalRef,
  sessionIdRef,
  unlistenOutputRef,
  unlistenExitRef,
  repoPathRef,
  shellType,
  customShellPath,
  shellOverride,
  argsOverride,
  envOverride,
  nameOverride,
  onSessionInfoReady,
  onPtyCreateRef,
  onSessionExitRef,
  setIsBrowserMode,
  setIsConnecting,
  abortSignal,
}: InitPtyConnectionParams) {
  const isAborted = () => abortSignal?.aborted === true;

  if (!isTauriReady()) {
    if (isAborted()) return;
    setIsBrowserMode(true);
    setIsConnecting(false);

    const terminal = terminalRef.current;
    if (terminal) {
      writeBrowserModeMessage(terminal);
    }
    return;
  }

  const sessionId = `terminal-pty-${sessionKey}`;
  sessionIdRef.current = sessionId;

  try {
    const terminal = terminalRef.current;
    if (!terminal || isAborted()) return;

    const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

    // Stable write callback — captured once per session so the hot IPC
    // handler never allocates a new closure per event.
    const terminalWrite = (d: string | Uint8Array) => terminal.write(d);

    // Register this pane with the output scheduler, suspended: chunks that
    // arrive during connect queue up in order but nothing is written until
    // the restore base (snapshot or cached buffer) is in place — otherwise
    // live output interleaves with the restore and garbles the screen.
    registerPane(sessionId, terminalWrite);
    suspendPane(sessionId);
    setPaneForeground(sessionId, isForeground);

    // Listeners must be registered before create/attach to avoid dropping
    // early output. Buffer events until that operation resolves the native
    // PTY generation, then accept only the matching instance. This prevents
    // delayed events from a prior PTY with the same tab session ID from
    // corrupting or ending its replacement.
    let generationResolved = false;
    let expectedGeneration: number | undefined;
    let sessionEnded = false;
    const pendingOutput: PtyOutputPayload[] = [];
    const pendingExit: PtyExitPayload[] = [];

    const matchesCurrentGeneration = (generation: number | undefined) =>
      expectedGeneration === undefined ||
      generation === undefined ||
      generation === expectedGeneration;

    const writeOutput = (payload: PtyOutputPayload) => {
      if (sessionEnded || !matchesCurrentGeneration(payload.generation)) return;

      const { byte_count: byteCount, seq, data } = payload;
      const chunk = ptyPayloadBytes(payload);

      if (chunk && chunk.length > 0) {
        const resolvedByteCount = byteCount ?? chunk.length;
        const decoded = utf8Decoder.decode(chunk, { stream: true });
        if (decoded) {
          scheduleWrite(
            sessionId,
            decoded,
            resolvedByteCount,
            terminalWrite,
            seq
          );
        } else {
          // Chunk ended mid-codepoint and decoded to nothing — the bytes
          // sit in the decoder but still count against the backend
          // flow-control window.
          ackBytesWithoutWrite(sessionId, resolvedByteCount);
        }
      } else if (data) {
        // Backward-compat branch (no byte_count from backend): estimate byte
        // length without a TextEncoder allocation. ASCII is 1 byte/char;
        // non-ASCII (rare in terminal hot path) inflates slightly — the
        // scheduler treats byte_count as a flow-control hint, not an exact
        // invariant, so a cheap over-estimate is correct.
        const encodedLen = estimateByteLength(data);
        scheduleWrite(sessionId, data, encodedLen, terminalWrite, seq);
      }
    };

    const handleOutput = (payload: PtyOutputPayload) => {
      if (!generationResolved) {
        pendingOutput.push(payload);
        return;
      }
      writeOutput(payload);
    };

    const finishSession = () => {
      if (sessionEnded) return;
      sessionEnded = true;

      // Drain any still-queued output before the banner so the final bytes
      // land in order (resume first in case exit raced a reconnect).
      resumePane(sessionId);
      flushBacklog(sessionId, Number.MAX_SAFE_INTEGER);

      const trailingOutput = utf8Decoder.decode();
      if (trailingOutput) {
        terminal.write(trailingOutput);
      }
      terminal.writeln("\r\n\x1b[33m[Session ended]\x1b[0m");
      unregisterPane(sessionId);

      // The session was removed by the backend before this event was sent.
      // Clearing the ref prevents this component's eventual unmount from
      // detaching a freshly recreated PTY with the same session ID.
      sessionIdRef.current = null;
      onSessionExitRef.current?.(sessionKey);
    };

    const handleExit = (payload: PtyExitPayload) => {
      if (!generationResolved) {
        pendingExit.push(payload);
        return;
      }
      if (matchesCurrentGeneration(payload.generation)) {
        finishSession();
      }
    };

    const unlistenOutput = await listenTauri<PtyOutputPayload>(
      `pty-output-${sessionId}`,
      (event) => {
        if (isAborted()) return;
        handleOutput(event.payload);
      }
    );
    if (isAborted()) {
      unlistenOutput();
      unregisterPane(sessionId);
      return;
    }
    unlistenOutputRef.current = unlistenOutput;

    const unlistenExit = await listenTauri<PtyExitPayload>(
      `pty-exit-${sessionId}`,
      (event) => {
        if (isAborted()) return;
        handleExit(event.payload);
      }
    );
    if (isAborted()) {
      unlistenExit();
      unlistenOutputRef.current?.();
      unlistenOutputRef.current = null;
      unregisterPane(sessionId);
      return;
    }
    unlistenExitRef.current = unlistenExit;

    if (isAborted()) return;
    let coversSeq: number | undefined;
    try {
      const connection = await reconnectOrCreatePty({
        cols,
        rows,
        sessionId,
        sessionKey,
        terminal,
        repoPath: repoPathRef.current,
        shellType,
        customShellPath,
        shellOverride,
        argsOverride,
        envOverride,
        nameOverride,
        onSessionInfoReady,
        onPtyCreate: onPtyCreateRef.current,
      });
      coversSeq = connection.coversSeq;
      expectedGeneration = connection.generation;
      generationResolved = true;

      for (const payload of pendingOutput.splice(0)) {
        writeOutput(payload);
      }
      for (const payload of pendingExit.splice(0)) {
        handleExit(payload);
      }
    } finally {
      // Always lift the suspension — a pane left suspended never renders.
      // Queued chunks the snapshot already covers are dropped here.
      resumePane(sessionId, coversSeq);
    }

    if (isAborted()) return;
    setIsConnecting(false);
    terminal.focus();
  } catch (error) {
    if (isAborted()) return;
    log.error("Failed to create/connect PTY session:", error);
    setIsConnecting(false);
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.writeln("\x1b[31mFailed to connect to system terminal\x1b[0m");
      terminal.writeln(`\x1b[90mError: ${error}\x1b[0m`);
    }
  }
}
