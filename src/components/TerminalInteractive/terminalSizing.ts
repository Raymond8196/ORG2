import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { MutableRefObject } from "react";

import { createLogger } from "@src/hooks/logger";

const log = createLogger("Terminal");

interface TerminalSizingRefs {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
}

export function createRedrawTerminalAfterLayoutChange({
  containerRef,
  terminalRef,
  fitAddonRef,
}: TerminalSizingRefs) {
  return () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const container = containerRef.current;
    if (!terminal || !fitAddon || !container) return;

    requestAnimationFrame(() => {
      if (!terminalRef.current || !fitAddonRef.current) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      try {
        terminal.clearTextureAtlas();
        fitAddon.fit();
        terminal.refresh(0, terminal.rows - 1);
      } catch (error) {
        log.warn("[Terminal] redraw after layout change failed:", error);
      }
    });
  };
}

/** Number of consecutive frames that must agree on dimensions before fitting. */
const STABLE_FRAMES_REQUIRED = 3;
/** Maximum frames to wait for stability before forcing a fit. */
const MAX_STABILITY_FRAMES = 4;

export function createFitTerminal({
  containerRef,
  terminalRef,
  fitAddonRef,
}: TerminalSizingRefs) {
  // Track pending stability check to avoid overlapping runs
  let stabilityRafId: number | null = null;

  const fitTerminal = (retryCount = 0) => {
    if (fitAddonRef.current && terminalRef.current && containerRef.current) {
      try {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          if (retryCount < 5) {
            setTimeout(
              () => fitTerminal(retryCount + 1),
              100 * Math.pow(2, retryCount)
            );
          }
          return;
        }

        // Cancel any in-progress stability check so the latest call wins
        if (stabilityRafId !== null) {
          cancelAnimationFrame(stabilityRafId);
          stabilityRafId = null;
        }

        let stableFrames = 0;
        let lastCols: number | undefined;
        let lastRows: number | undefined;
        let framesChecked = 0;

        const checkStability = () => {
          stabilityRafId = null;
          const fitAddon = fitAddonRef.current;
          const terminal = terminalRef.current;
          if (!fitAddon || !terminal) return;

          try {
            const dims = fitAddon.proposeDimensions();
            framesChecked++;

            if (dims && dims.cols === lastCols && dims.rows === lastRows) {
              stableFrames++;
            } else {
              stableFrames = 1;
              lastCols = dims?.cols;
              lastRows = dims?.rows;
            }

            if (
              stableFrames >= STABLE_FRAMES_REQUIRED ||
              framesChecked >= MAX_STABILITY_FRAMES
            ) {
              // Dimensions are stable — commit the fit
              terminal.clearTextureAtlas();
              fitAddon.fit();
              terminal.refresh(0, terminal.rows - 1);
            } else {
              stabilityRafId = requestAnimationFrame(checkStability);
            }
          } catch (error) {
            log.warn("[Terminal] Fit stability check error:", error);
            // Fall back to immediate fit
            try {
              fitAddonRef.current?.fit();
            } catch {
              // ignore
            }
          }
        };

        stabilityRafId = requestAnimationFrame(checkStability);
      } catch (error) {
        log.warn("[Terminal] Fit error:", error);
      }
    }
  };

  return fitTerminal;
}
