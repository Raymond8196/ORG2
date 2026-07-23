import { useEffect, useRef, useState } from "react";

import { isWindowFocused } from "@src/util/core/windowFocus";

/**
 * Realtime demand is strictly tied to an interactive desktop window. Local
 * event writes and the durable project outbox use their own event-driven HTTP
 * paths, so a hidden/unfocused window has no reason to retain a billable
 * socket. Returning focus reacquires immediately; each channel's SUBSCRIBED
 * true-edge performs the compensating recovery read.
 */
export interface Org2CloudRealtimeLeaseController {
  /** Re-evaluate foreground state after focus/blur/visibility changes. */
  refresh(): void;
  /** Release immediately (pagehide / app teardown). */
  releaseImmediately(): void;
  /** Stop publishing state transitions. */
  dispose(): void;
  /** Test/diagnostic snapshot; React consumers use the change callback. */
  isHeld(): boolean;
}

interface CreateOrg2CloudRealtimeLeaseControllerOptions {
  readonly isForeground: () => boolean;
  readonly onChange: (held: boolean) => void;
  readonly initialHeld?: boolean;
}

/**
 * Small explicit state machine for the billable Realtime connection lease:
 * foreground = held, background/hidden = released. It contains no cadence,
 * polling loop, grace timeout, or keepalive of its own.
 */
export function createOrg2CloudRealtimeLeaseController({
  isForeground,
  onChange,
  initialHeld = isForeground(),
}: CreateOrg2CloudRealtimeLeaseControllerOptions): Org2CloudRealtimeLeaseController {
  let held = initialHeld;
  let disposed = false;

  const publish = (nextHeld: boolean) => {
    if (held === nextHeld || disposed) return;
    held = nextHeld;
    onChange(nextHeld);
  };

  return {
    refresh: () => publish(isForeground()),
    releaseImmediately: () => publish(false),
    dispose: () => {
      disposed = true;
    },
    isHeld: () => held,
  };
}

/**
 * React binding for the connection lease. This hook owns browser lifecycle
 * listeners only; the caller remains the single owner of the Supabase client
 * and all of its channels.
 */
export function useOrg2CloudRealtimeLease(): boolean {
  const [held, setHeld] = useState(() => isWindowFocused());
  const initialHeldRef = useRef(held);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }
    const controller = createOrg2CloudRealtimeLeaseController({
      isForeground: isWindowFocused,
      // Preserve the render-time truth so a focus transition between render
      // and effect setup is reconciled instead of silently skipped.
      initialHeld: initialHeldRef.current,
      onChange: setHeld,
    });

    const refresh = () => controller.refresh();
    const release = () => controller.releaseImmediately();
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", refresh);
    window.addEventListener("pagehide", release);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    controller.refresh();

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", refresh);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
      controller.dispose();
    };
  }, []);

  return held;
}
