import { describe, expect, it } from "vitest";

import {
  parseCanvasSlashCommand,
  resolveCanvasSlashAgentContent,
} from "../canvasSlashCommand";

describe("Canvas slash command", () => {
  it("parses bare, instructed, and multiline commands", () => {
    expect(parseCanvasSlashCommand(" /canvas ")).toEqual({});
    expect(parseCanvasSlashCommand("/CANVAS build a coffee order UI")).toEqual({
      instruction: "build a coffee order UI",
    });
    expect(parseCanvasSlashCommand("/canvas\n第一行\n第二行")).toEqual({
      instruction: "第一行\n第二行",
    });
  });

  it("does not claim ordinary prose or lookalike commands", () => {
    expect(parseCanvasSlashCommand("please use /canvas later")).toBeNull();
    expect(parseCanvasSlashCommand("/canvasish build this")).toBeNull();
    expect(parseCanvasSlashCommand("/canvas/design")).toBeNull();
  });

  it("resolves an instructed command to the creation tool contract", () => {
    const content = resolveCanvasSlashAgentContent(
      "/canvas build a stateful timer"
    );

    expect(content).toContain("render_inline_canvas exactly once");
    expect(content).toContain("new Canvas rather than an edit");
    expect(content).toContain("build a stateful timer");
  });

  it("asks for requirements when a bare command is submitted", () => {
    const content = resolveCanvasSlashAgentContent("/canvas");

    expect(content).toContain("Ask what they want to build");
    expect(content).toContain("Do not call render_inline_canvas yet");
  });

  it("leaves unrelated messages unchanged", () => {
    expect(resolveCanvasSlashAgentContent("draw a canvas bag")).toBeNull();
  });
});
