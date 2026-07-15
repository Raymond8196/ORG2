import { describe, expect, it } from "vitest";

import { rpc } from "../router";
import {
  SessionProvenanceHookPlatformSchema,
  SessionProvenanceRecentSignalSchema,
} from "../schemas/agentOrgs";

describe("session provenance RPC schemas", () => {
  it("accepts every managed hook platform, including the newer CLIs", () => {
    for (const platform of [
      "claude_code",
      "codex",
      "cursor",
      "qwen_code",
      "factory_droid",
      "trae",
      "opencode",
      "windsurf",
      "kimi",
      "antigravity",
      "zcode",
    ]) {
      expect(SessionProvenanceHookPlatformSchema.parse(platform)).toBe(
        platform
      );
    }
    // `warp` has no agent command-hook mechanism and must not be a platform.
    expect(() => SessionProvenanceHookPlatformSchema.parse("warp")).toThrow();
    expect(() =>
      SessionProvenanceHookPlatformSchema.parse("gemini_cli")
    ).toThrow();
  });

  it("parses a recent hook signal from the Rust camelCase payload", () => {
    const parsed = SessionProvenanceRecentSignalSchema.parse({
      source: "qwen_code",
      sessionId: "qwencodeapp-qwen-1",
      sessionTitle: "Refactor the auth flow",
      actorId: null,
      filePath: "src/app.rs",
      workspacePath: "/repo/worktree",
      action: "write",
      outcome: "succeeded",
      occurredAt: "2026-07-15T01:00:00.000Z",
      captureMethod: "hook",
    });
    expect(parsed.source).toBe("qwen_code");
    expect(parsed.action).toBe("write");
    expect(parsed.sessionTitle).toBe("Refactor the auth flow");
  });

  it("accepts a null session title for hook-only sessions", () => {
    const parsed = SessionProvenanceRecentSignalSchema.parse({
      source: "claude_code",
      sessionId: "claudecodeapp-1f225314",
      sessionTitle: null,
      filePath: "src/store/sqlite.rs",
      workspacePath: "/repo",
      action: "read",
      outcome: "succeeded",
      occurredAt: "2026-07-15T03:00:00.000Z",
      captureMethod: "hook",
    });
    expect(parsed.sessionTitle).toBeNull();
  });

  it("keeps unknown action kinds as a plain string instead of dropping the row", () => {
    const parsed = SessionProvenanceRecentSignalSchema.parse({
      source: "droid",
      sessionId: "droidapp-1",
      filePath: "README.md",
      workspacePath: "/repo",
      action: "future_action",
      outcome: "unknown",
      occurredAt: "2026-07-15T02:00:00.000Z",
      captureMethod: "hook",
    });
    expect(parsed.action).toBe("future_action");
  });

  it("exposes the recentSignals procedure on the typed router", () => {
    expect(typeof rpc.agentOrgs.sessionProvenance.recentSignals).toBe(
      "function"
    );
    expect(typeof rpc.agentOrgs.sessionProvenance.status).toBe("function");
    expect(typeof rpc.agentOrgs.sessionProvenance.setEnabled).toBe("function");
  });
});
