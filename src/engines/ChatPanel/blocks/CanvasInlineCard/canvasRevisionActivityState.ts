import { getCanvasRevisionTextEdits } from "./canvasRevision";

export type CanvasRevisionActivityPhase =
  | "receiving"
  | "applying"
  | "completed"
  | "failed"
  | "cancelled";

export type CanvasRevisionStepState =
  | "complete"
  | "active"
  | "pending"
  | "failed";

export interface CanvasRevisionStepStates {
  target: CanvasRevisionStepState;
  generate: CanvasRevisionStepState;
  apply: CanvasRevisionStepState;
}

export type CanvasRevisionChangeKind =
  | "targeted"
  | "replacement"
  | "url"
  | "unknown";

export interface CanvasRevisionActivitySummary {
  title?: string;
  changeKind: CanvasRevisionChangeKind;
  editCount: number;
  payloadCharacters: number;
}

export function getCanvasRevisionStepStates(
  phase: CanvasRevisionActivityPhase
): CanvasRevisionStepStates {
  switch (phase) {
    case "receiving":
      return { target: "complete", generate: "active", apply: "pending" };
    case "applying":
      return { target: "complete", generate: "complete", apply: "active" };
    case "completed":
      return { target: "complete", generate: "complete", apply: "complete" };
    case "failed":
      return { target: "complete", generate: "complete", apply: "failed" };
    case "cancelled":
      return { target: "complete", generate: "failed", apply: "pending" };
  }
}

export function summarizeCanvasRevisionActivity(
  args: Record<string, unknown>
): CanvasRevisionActivitySummary {
  const edits = getCanvasRevisionTextEdits(args);
  const content = typeof args.content === "string" ? args.content : undefined;
  const url = typeof args.url === "string" ? args.url : undefined;

  return {
    title:
      typeof args.title === "string"
        ? args.title.trim() || undefined
        : undefined,
    changeKind: edits
      ? "targeted"
      : content !== undefined
        ? "replacement"
        : url
          ? "url"
          : "unknown",
    editCount: edits?.length ?? 0,
    payloadCharacters: content?.length ?? 0,
  };
}
