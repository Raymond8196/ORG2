/**
 * Durable record of the comment ids for which THIS client posted an `@agent `
 * mention (and thus created the pickup task itself).
 *
 * The auto-run gate must distinguish your OWN @agent mention (run it — your
 * intent, your account) from a teammate's (stay gated behind the owner opt-in
 * so it can never silently spend your tokens). The list-tasks RPC's
 * `created_by` is GDPR-nullable and not reliably surfaced client-side, so we
 * record self-authorship at the exact point the client fires the create RPC
 * (CommentThreadList's `@agent ` submit path). Bounded, corrupt payloads reset.
 */
const STORAGE_KEY = "orgii:selfAgentTaskComments:v1";
const MAX_ENTRIES = 500;

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** Record that YOU created the @agent pickup task for this comment. */
export function recordSelfAgentComment(commentId: string): void {
  if (!commentId) return;
  try {
    const current = read().filter((id) => id !== commentId);
    current.unshift(commentId);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(current.slice(0, MAX_ENTRIES))
    );
  } catch {
    // Best-effort: a full/unavailable store just means this task stays gated
    // behind the opt-in — never a crash on the comment-submit happy path.
  }
}

/** True when this comment's @agent task was created by you on this machine. */
export function isSelfAgentComment(commentId: string): boolean {
  return commentId ? read().includes(commentId) : false;
}
