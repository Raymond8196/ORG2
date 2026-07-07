import { describe, expect, it } from "vitest";

import type { TerminalSession } from "@src/engines/TerminalCore/types";

import { selectRepoSyncTargets } from "../repoSyncTargets";

function makeSession(
  id: string,
  overrides: Partial<TerminalSession> = {}
): TerminalSession {
  return { id, name: id, isActive: false, ...overrides };
}

describe("selectRepoSyncTargets", () => {
  it("selects an initialized regular terminal", () => {
    const sessions = [makeSession("terminal-1")];
    const initialized = new Set(["terminal-1"]);

    expect(selectRepoSyncTargets(sessions, initialized)).toEqual(sessions);
  });

  it("excludes readOnly terminals", () => {
    const sessions = [makeSession("terminal-1", { readOnly: true })];
    const initialized = new Set(["terminal-1"]);

    expect(selectRepoSyncTargets(sessions, initialized)).toHaveLength(0);
  });

  it("excludes agent-pty- terminals", () => {
    const sessions = [makeSession("agent-pty-sdeagent-123")];
    const initialized = new Set(["agent-pty-sdeagent-123"]);

    expect(selectRepoSyncTargets(sessions, initialized)).toHaveLength(0);
  });

  // Regression: chat-panel terminals host interactive CLI agent TUIs (codex /
  // claude / gemini). Injecting `cd '<path>'` corrupts the running TUI.
  it("excludes chatpanel- terminals", () => {
    const sessions = [makeSession("chatpanel-abc-123")];
    const initialized = new Set(["chatpanel-abc-123"]);

    expect(selectRepoSyncTargets(sessions, initialized)).toHaveLength(0);
  });

  it("excludes uninitialized terminals even when regular", () => {
    const sessions = [makeSession("terminal-1")];
    const initialized = new Set<string>();

    expect(selectRepoSyncTargets(sessions, initialized)).toHaveLength(0);
  });

  it("mixes: keeps eligible terminals and drops every excluded class", () => {
    const sessions = [
      makeSession("terminal-1"), // eligible
      makeSession("terminal-2", { readOnly: true }), // readOnly
      makeSession("agent-pty-sdeagent-1"), // agent-pty
      makeSession("chatpanel-cli-agent"), // chat-panel TUI host
      makeSession("terminal-3"), // not initialized
    ];
    const initialized = new Set([
      "terminal-1",
      "terminal-2",
      "agent-pty-sdeagent-1",
      "chatpanel-cli-agent",
    ]);

    expect(
      selectRepoSyncTargets(sessions, initialized).map((s) => s.id)
    ).toEqual(["terminal-1"]);
  });
});
