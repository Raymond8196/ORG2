import { describe, expect, it, vi } from "vitest";

import {
  collectImportedSessionIdsCoveredByAnyScope,
  collectScopeMatchedImportedSessionIds,
} from "./importedSessionScopeMatch";

const PEEK = (path: string) =>
  path === "/Users/me/org2"
    ? "github.com/yorgai/org2"
    : path === "/Users/me/other"
      ? "github.com/yorgai/other"
      : null;

const sessions = [
  {
    session_id: "claude-code:1",
    category: "external_history" as const,
    orgId: undefined,
    repoPath: "/Users/me/org2",
  },
  {
    session_id: "claude-code:2",
    category: "external_history" as const,
    orgId: undefined,
    repoPath: "/Users/me/other",
  },
  {
    session_id: "native-1",
    category: undefined,
    orgId: undefined,
    repoPath: "/Users/me/org2",
  },
  {
    session_id: "claude-code:3",
    category: "external_history" as const,
    orgId: "already-stamped",
    repoPath: "/Users/me/org2",
  },
  {
    session_id: "claude-code:4",
    category: "external_history" as const,
    orgId: undefined,
    repoPath: undefined,
  },
];

describe("collectScopeMatchedImportedSessionIds", () => {
  it("matches imported sessions whose repo is inside the org scope", () => {
    const ids = collectScopeMatchedImportedSessionIds(
      sessions,
      ["github.com/yorgai/org2"],
      PEEK
    );
    expect(ids).toEqual(new Set(["claude-code:1"]));
  });

  it("returns empty for a scope-less org", () => {
    expect(collectScopeMatchedImportedSessionIds(sessions, [], PEEK)).toEqual(
      new Set()
    );
    expect(
      collectScopeMatchedImportedSessionIds(sessions, undefined, PEEK)
    ).toEqual(new Set());
  });

  it("skips native, stamped, and repo-less sessions", () => {
    const ids = collectScopeMatchedImportedSessionIds(
      sessions,
      ["github.com/yorgai/org2", "github.com/yorgai/other"],
      PEEK
    );
    expect(ids.has("native-1")).toBe(false);
    expect(ids.has("claude-code:3")).toBe(false);
    expect(ids.has("claude-code:4")).toBe(false);
  });

  it("primes unresolved paths and defers matching", () => {
    const prime = vi.fn();
    const ids = collectScopeMatchedImportedSessionIds(
      sessions,
      ["github.com/yorgai/org2"],
      () => undefined,
      prime
    );
    expect(ids.size).toBe(0);
    expect(prime).toHaveBeenCalledWith("/Users/me/org2");
  });
});

describe("collectImportedSessionIdsCoveredByAnyScope", () => {
  it("covers a session scoped by ANY member org — no ambiguity rule", () => {
    const ids = collectImportedSessionIdsCoveredByAnyScope(
      sessions,
      ["org-a", "org-b"],
      {
        "org-a": ["github.com/yorgai/org2"],
        "org-b": ["github.com/yorgai/org2", "github.com/yorgai/other"],
      },
      PEEK
    );
    expect(ids).toEqual(new Set(["claude-code:1", "claude-code:2"]));
  });

  it("ignores scopes of non-member orgs", () => {
    const ids = collectImportedSessionIdsCoveredByAnyScope(
      sessions,
      ["org-b"],
      {
        "org-a": ["github.com/yorgai/org2"],
        "org-b": ["github.com/yorgai/other"],
      },
      PEEK
    );
    expect(ids).toEqual(new Set(["claude-code:2"]));
  });

  it("returns empty with no member orgs", () => {
    expect(
      collectImportedSessionIdsCoveredByAnyScope(sessions, [], {}, PEEK)
    ).toEqual(new Set());
  });
});
