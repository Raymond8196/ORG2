import { describe, expect, it } from "vitest";

import type { WorkItemData } from "@src/api/http/project";

import {
  getSubItemStageNumbers,
  groupSubItemsByStage,
} from "./WorkItemSubItems";

function child(shortId: string, stage?: number): WorkItemData {
  return {
    body: "",
    filename: `${shortId}.md`,
    frontmatter: {
      id: shortId,
      short_id: shortId,
      title: shortId,
      status: "planned",
      priority: "none",
      labels: [],
      stage,
      created_at: "2026-08-08T00:00:00.000Z",
      updated_at: "2026-08-08T00:00:00.000Z",
      starred: false,
      todos: [],
    },
  };
}

describe("WorkItemSubItems stage model", () => {
  it("offers stage 1 for a parent without staged children", () => {
    expect(getSubItemStageNumbers([])).toEqual([1]);
    expect(getSubItemStageNumbers([child("WI-0002")])).toEqual([1]);
  });

  it("offers every existing stage plus the next sequential stage", () => {
    expect(
      getSubItemStageNumbers([
        child("WI-0002", 1),
        child("WI-0003", 3),
        child("WI-0004"),
      ])
    ).toEqual([1, 2, 3, 4]);
  });

  it("keeps unstaged children after ordered stage groups", () => {
    expect(
      groupSubItemsByStage([
        child("WI-0002"),
        child("WI-0003", 2),
        child("WI-0004", 1),
      ]).map((group) => group.label)
    ).toEqual(["Stage 1", "Stage 2", "No stage"]);
  });
});
