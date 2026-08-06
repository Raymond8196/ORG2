import { describe, expect, it } from "vitest";

import {
  getCanvasRevisionStepStates,
  summarizeCanvasRevisionActivity,
} from "../canvasRevisionActivityState";

describe("Canvas revision activity state", () => {
  it("moves the factual work steps through receiving, applying, and completion", () => {
    expect(getCanvasRevisionStepStates("receiving")).toEqual({
      target: "complete",
      generate: "active",
      apply: "pending",
    });
    expect(getCanvasRevisionStepStates("applying")).toEqual({
      target: "complete",
      generate: "complete",
      apply: "active",
    });
    expect(getCanvasRevisionStepStates("completed")).toEqual({
      target: "complete",
      generate: "complete",
      apply: "complete",
    });
  });

  it("marks the apply step failed without claiming the Canvas changed", () => {
    expect(getCanvasRevisionStepStates("failed")).toEqual({
      target: "complete",
      generate: "complete",
      apply: "failed",
    });
  });

  it("summarizes compact edits without exposing source contents", () => {
    expect(
      summarizeCanvasRevisionActivity({
        title: "Coffee sketch",
        edits: [
          { find: "Start", replace: "Start setup" },
          { find: "13px", replace: "15px" },
        ],
      })
    ).toEqual({
      title: "Coffee sketch",
      changeKind: "targeted",
      editCount: 2,
      payloadCharacters: 0,
    });
  });

  it("distinguishes full replacements, URLs, and empty legacy payloads", () => {
    expect(
      summarizeCanvasRevisionActivity({ content: "function App() {}" })
    ).toMatchObject({ changeKind: "replacement", payloadCharacters: 17 });
    expect(
      summarizeCanvasRevisionActivity({ url: "https://example.com" })
    ).toMatchObject({ changeKind: "url" });
    expect(summarizeCanvasRevisionActivity({})).toMatchObject({
      changeKind: "unknown",
    });
  });
});
