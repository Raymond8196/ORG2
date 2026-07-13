const FILES_MENTIONED_HEADING = /^#{1,6}\s+Files mentioned by the user:\s*$/i;

/**
 * Removes the injected file-section heading from the start of a user message.
 * When the section has no entries or request text, this returns an empty string
 * so the history does not render a heading-only bubble.
 */
export function normalizeUserMessageText(text: string): string {
  const lines = text.split(/\r?\n/);
  if (!FILES_MENTIONED_HEADING.test(lines[0]?.trim() ?? "")) return text;

  const remainder = lines
    .slice(1)
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "");
  return remainder.trim() ? remainder : "";
}
