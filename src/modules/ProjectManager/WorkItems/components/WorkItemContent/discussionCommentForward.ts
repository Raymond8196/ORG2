/**
 * discussionCommentForward
 *
 * Turns a human Discussion comment into a Reply turn on the item's
 * linked session, so the Discussion is a live channel instead of a
 * write-only log. The agent is instructed to answer through
 * `org2-pm work note --kind comment` — its reply lands back on the
 * same Discussion, closing the loop. Agent-authored notes arrive via
 * the CLI, never through this UI submit path, so forwarding cannot
 * recurse.
 */
import type { LinkedSession } from "@src/api/http/project/types/agentWorkflow";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("discussionCommentForward");

/**
 * Latest top-level linked session; sub-agent sessions never own the
 * conversation, so they are skipped.
 */
export function pickForwardTargetSession(
  linkedSessions: LinkedSession[] | undefined
): LinkedSession | null {
  const candidates = (linkedSessions ?? []).filter(
    (session) => !session.parent_session_id
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) =>
    (b.started_at ?? "").localeCompare(a.started_at ?? "")
  )[0];
}

export function buildDiscussionForwardMessage({
  shortId,
  author,
  comment,
}: {
  shortId: string;
  author: string;
  comment: string;
}): { content: string; displayText: string } {
  const content = [
    `[Work Item Discussion] ${author} commented on ${shortId}:`,
    "",
    comment,
    "",
    "This is a Reply turn. Answer on the Discussion with exactly one receipt:",
    `  org2-pm work note ${shortId} --kind comment --body "<your reply>"`,
    "(use --body-file for multi-line or shell-sensitive replies)",
    "Do not change status or edit fields unless the comment explicitly asks for it.",
  ].join("\n");
  const displayText = `💬 ${comment}`;
  return { content, displayText };
}

/**
 * One-click retry of a failed linked run: the
 * failed session is resumed with a retry brief so it can finish the
 * remaining work and deliver through org2-pm. Fire-and-forget; failures
 * (session gone, other device) only log.
 */
export function retryFailedLinkedSession({
  shortId,
  sessionId,
}: {
  shortId: string;
  sessionId: string;
}): void {
  if (!shortId || !sessionId) return;
  const content = [
    `[Retry] The previous run on ${shortId} did not finish successfully.`,
    "",
    `Re-read the item with \`org2-pm work show ${shortId}\`, finish the remaining work,`,
    "and deliver through org2-pm with exactly one Discussion receipt.",
  ].join("\n");
  void SessionService.sendMessage({
    sessionId,
    content,
    displayText: `↻ Retry ${shortId}`,
    turnIntentSource: "user_submit",
  }).catch((error) => {
    logger.warn(`Retry forward to ${sessionId} failed: ${String(error)}`);
  });
}

/**
 * Fire-and-forget forward. Failures (session busy, session not on this
 * device) only log — the comment itself is already durably on the item.
 */
export function forwardDiscussionCommentToLinkedSession({
  shortId,
  author,
  comment,
  linkedSessions,
}: {
  shortId: string;
  author: string;
  comment: string;
  linkedSessions: LinkedSession[] | undefined;
}): void {
  const target = pickForwardTargetSession(linkedSessions);
  if (!target || !shortId) return;
  const { content, displayText } = buildDiscussionForwardMessage({
    shortId,
    author,
    comment,
  });
  void SessionService.sendMessage({
    sessionId: target.session_id,
    content,
    displayText,
    turnIntentSource: "user_submit",
  }).catch((error) => {
    logger.warn(
      `Discussion forward to ${target.session_id} failed: ${String(error)}`
    );
  });
}
