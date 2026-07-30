/**
 * Slack-style channel-name normalization, mirrored from the server rules in
 * `cloud_create_channel` (0014): trimmed, case-folded, leading '#' stripped,
 * no whitespace, 1..80 chars. The client additionally converts inner
 * whitespace runs to single hyphens as the user types (Slack behavior) so
 * "Launch Swarm" becomes "launch-swarm" instead of a validation error.
 */
import { CHANNEL_NAME_MAX_LENGTH } from "./types";

/** Live-typing normalization: what the create dialog stores per keystroke. */
export function normalizeChannelNameInput(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, CHANNEL_NAME_MAX_LENGTH);
}

/** Submit-time normalization: also drops edge hyphens left by typing. */
export function normalizeChannelName(raw: string): string {
  return normalizeChannelNameInput(raw.trim()).replace(/^-+|-+$/g, "");
}

export type ChannelNameError = "empty" | "tooLong" | "whitespace";

/** Validates an already-normalized name against the server contract. */
export function validateChannelName(name: string): ChannelNameError | null {
  if (name.length === 0) return "empty";
  if (name.length > CHANNEL_NAME_MAX_LENGTH) return "tooLong";
  if (/\s/.test(name) || name.startsWith("#")) return "whitespace";
  return null;
}
