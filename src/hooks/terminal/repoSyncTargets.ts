/**
 * Pure selection logic for `useTerminalRepoSync`.
 *
 * Extracted so the workspace-cd broadcast guard can be unit-tested without a
 * React renderer (the host project ships neither `@testing-library/react` nor
 * jsdom). See `__tests__/repoSyncTargets.test.ts`.
 */
import type { TerminalSession } from "@src/engines/TerminalCore/types";
import { isChatPanelTerminalId } from "@src/util/ui/terminal/chatPanelSessionId";
import { isAgentPtySessionId } from "@src/util/ui/terminal/ptySessionId";

/**
 * Pick the terminals that should receive a `cd <repoPath>` broadcast when the
 * active workspace changes.
 *
 * Excluded:
 *   - `readOnly` terminals (output-only agent views)
 *   - `agent-pty-` terminals (Rust agent-core exec tooling)
 *   - `chatpanel-` terminals (host interactive CLI agent TUIs like codex;
 *     injecting `cd` corrupts the running TUI)
 *   - not-yet-initialized terminals (no live PTY to write to)
 */
export function selectRepoSyncTargets(
  sessions: TerminalSession[],
  initialized: Set<string>
): TerminalSession[] {
  return sessions.filter(
    (session) =>
      !session.readOnly &&
      !isAgentPtySessionId(session.id) &&
      !isChatPanelTerminalId(session.id) &&
      initialized.has(session.id)
  );
}
