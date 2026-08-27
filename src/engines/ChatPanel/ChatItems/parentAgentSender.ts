import {
  isAgentChildSession,
  resolveAgentChildParentSessionId,
} from "@src/util/session/agentChildSession";

export interface ParentAgentSenderInput {
  sessionId: string;
  parentSessionId?: string | null;
  orgMemberId?: string | null;
  background?: boolean;
}

/**
 * The session whose agent wrote this session's user-role turns, or null when
 * the reader is the author.
 *
 * A subagent's dispatch prompt is stored with the same `user` role the
 * composer produces — the orchestrator hands the child a system + user pair,
 * and a re-dispatch appends another user turn — so the message list cannot
 * tell them apart by role. It can tell them apart by session: nothing in an
 * agent-started session's transcript came from the person reading it, so every
 * user turn there belongs to whichever session spawned it.
 *
 * Null when the session is not an agent child, and null when the parent cannot
 * be identified: a message attributed to nobody reads worse than one left on
 * the viewer's side.
 */
export function resolveParentAgentSenderSessionId(
  input: ParentAgentSenderInput
): string | null {
  if (!isAgentChildSession(input)) return null;
  return resolveAgentChildParentSessionId(
    input.sessionId,
    input.parentSessionId
  );
}
