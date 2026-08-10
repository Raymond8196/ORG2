interface CanvasSlashCommand {
  /** Optional creation request following `/canvas`. */
  instruction?: string;
}

/**
 * Parse a start-anchored `/canvas [request]` command without claiming ordinary
 * prose that merely contains the same text.
 */
export function parseCanvasSlashCommand(
  text: string
): CanvasSlashCommand | null {
  const match = /^\/canvas(?:\s+([\s\S]+))?$/i.exec(text.trim());
  if (!match) return null;
  const instruction = match[1]?.trim();
  return instruction ? { instruction } : {};
}

/**
 * Keep `/canvas …` as the user-visible message while giving the Agent an
 * explicit, deterministic Canvas tool contract.
 */
export function resolveCanvasSlashAgentContent(text: string): string | null {
  const command = parseCanvasSlashCommand(text);
  if (!command) return null;

  if (!command.instruction) {
    return `[Canvas Creation Request]\nThe user opened the Canvas creation command without a request. Ask what they want to build before creating anything. Do not call render_inline_canvas yet.`;
  }

  return `[Canvas Creation Request]\nCreate a new interactive inline Canvas for the user request below. Call render_inline_canvas exactly once for the finished Canvas. Treat this as a new Canvas rather than an edit to an existing Canvas. Preserve the user's requested behavior and language.\n\n[User Request]\n${command.instruction}`;
}
