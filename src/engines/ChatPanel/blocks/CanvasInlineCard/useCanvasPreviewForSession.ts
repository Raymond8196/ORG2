/**
 * useCanvasPreviewForSession — thin compatibility shim over useCanvasForTurn.
 *
 * New code should call useCanvasForTurn directly; this wrapper preserves the
 * existing interface so callers (ChatVariant, PinnedActionsBar) can migrate
 * gradually without a forced simultaneous change.
 */
import type { CanvasInlinePayload } from "./types";
import { useCanvasForTurn } from "./useCanvasForTurn";

export function useCanvasPreviewForSession(
  sessionId: string | null | undefined
): {
  payload: CanvasInlinePayload | null;
  dismiss: () => void;
  clearCanvas: () => void;
} {
  const { payload, dismiss, clearCanvas } = useCanvasForTurn(sessionId);
  return { payload, dismiss, clearCanvas };
}
