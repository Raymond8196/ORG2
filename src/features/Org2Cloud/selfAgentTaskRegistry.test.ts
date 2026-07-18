import { beforeEach, describe, expect, it } from "vitest";

import {
  isSelfAgentComment,
  recordSelfAgentComment,
} from "./selfAgentTaskRegistry";

describe("selfAgentTaskRegistry", () => {
  beforeEach(() => localStorage.clear());

  it("records and recognizes a self-authored @agent comment", () => {
    expect(isSelfAgentComment("c1")).toBe(false);
    recordSelfAgentComment("c1");
    expect(isSelfAgentComment("c1")).toBe(true);
    expect(isSelfAgentComment("c2")).toBe(false);
  });

  it("is idempotent and ignores empty ids", () => {
    recordSelfAgentComment("c1");
    recordSelfAgentComment("c1");
    recordSelfAgentComment("");
    expect(isSelfAgentComment("c1")).toBe(true);
    expect(isSelfAgentComment("")).toBe(false);
  });

  it("survives a corrupt payload (resets, never throws)", () => {
    localStorage.setItem("orgii:selfAgentTaskComments:v1", "{not json");
    expect(isSelfAgentComment("c1")).toBe(false);
    recordSelfAgentComment("c1");
    expect(isSelfAgentComment("c1")).toBe(true);
  });

  it("bounds the list so it cannot grow without limit", () => {
    for (let i = 0; i < 600; i += 1) recordSelfAgentComment(`c${i}`);
    // Most recent is kept; the oldest beyond the cap is evicted.
    expect(isSelfAgentComment("c599")).toBe(true);
    expect(isSelfAgentComment("c0")).toBe(false);
  });
});
