/**
 * Splitting a posted channel body into prose and session references.
 *
 * A dropped session is stored inside the body as ordinary pill syntax
 * (`title [session:<id>]`) because that is what the composer serializes. On
 * the READ side a channel promotes it out of the sentence and renders it as a
 * `ChannelSessionCard`, so the body has to be split first.
 *
 * The split runs through `parsePillTextToSnapshot` rather than a bespoke
 * regex: that parser already owns the tricky "where does the display label
 * end" rule (last whitespace-delimited token, with a CJK fallback), and
 * re-deciding it here is how the prose and the card would drift apart. The
 * leftover parts are re-serialized with `serializePillNode`, the exact
 * inverse, so any OTHER pill type (file, folder, link…) survives untouched
 * and still renders through the read-only composer.
 */
import { serializePillNode } from "@src/components/ComposerInput";
import { parsePillTextToSnapshot } from "@src/engines/ChatPanel/InputArea/utils/pillContentParser";

export interface ChannelSessionReference {
  sessionId: string;
  /** Title snapshot as posted — the fallback when the session is gone. */
  title: string;
}

export interface ChannelMessageBodyParts {
  /** Body with the session references removed; may be empty. */
  text: string;
  /** Referenced sessions, in the order they appeared, de-duplicated. */
  references: ChannelSessionReference[];
}

/** `session://<id>/<ts>`, `<id>::<blob>` and a bare id all name one session. */
export function sessionIdFromPillPath(path: string): string {
  const withoutScheme = path.startsWith("session://")
    ? path.slice("session://".length)
    : path;
  return withoutScheme.split("::")[0].split("/")[0];
}

export function splitChannelMessageBody(body: string): ChannelMessageBodyParts {
  const { parts } = parsePillTextToSnapshot(body);
  const references: ChannelSessionReference[] = [];
  const seen = new Set<string>();
  let text = "";

  for (const part of parts) {
    if (part.kind === "newline") {
      text += "\n";
      continue;
    }
    if (part.kind === "text") {
      text += part.text;
      continue;
    }
    if (part.attrs.iconType !== "session") {
      text += serializePillNode(part.attrs);
      continue;
    }
    const sessionId = sessionIdFromPillPath(part.attrs.filePath);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    references.push({
      sessionId,
      title: part.attrs.fileName.trim() || sessionId,
    });
  }

  // Pulling a reference out of the middle of a sentence leaves the gap it
  // used to fill; collapse it so the prose does not read with a hole in it.
  return { text: text.replace(/[^\S\n]{2,}/gu, " ").trim(), references };
}
