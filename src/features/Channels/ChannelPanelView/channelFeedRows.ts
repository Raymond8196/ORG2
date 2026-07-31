/**
 * Pure transcript model for the channel surface: a flat, virtualizable row
 * list with date dividers and Slack-style consecutive-message grouping.
 *
 * The date-bucketing and label rules are lifted from the orphaned Inbox feed
 * (`src/modules/MainApp/Inbox/config.ts` — `getDateKey`,
 * `formatDateGroupLabel` — and `ChannelFeedPanel.tsx`'s `DateGroupSection`)
 * so the two feeds bucket identically. Two deliberate departures from that
 * parts bin:
 *   1. dividers are ROWS, not nested sections. A virtualizer needs one flat
 *      index space; nesting messages under a group element would force the
 *      whole group to measure as a single item.
 *   2. labels are i18n'd. The Inbox version hard-codes English "Today" /
 *      "Yesterday" and an English `DAY_NAMES` table; here the two relative
 *      days come from the caller's `t` and everything older is formatted by
 *      `Intl` in the active locale.
 */
import type { LocalChannelMessage } from "@src/store/ui/localChannelMessagesAtom";
import {
  getLocalDateKey,
  getLocalDayDiff,
} from "@src/util/data/formatters/date";

/**
 * Consecutive messages inside this window collapse into the previous row's
 * block (no repeated avatar / author line) — the transcript reads as one
 * utterance instead of a stack of identical headers.
 */
export const CHANNEL_MESSAGE_GROUPING_WINDOW_MS = 5 * 60 * 1000;

export type ChannelFeedRow =
  | { kind: "divider"; id: string; dateKey: string }
  | {
      kind: "message";
      id: string;
      message: LocalChannelMessage;
      /** True when this row continues the block above (header suppressed). */
      grouped: boolean;
    };

function parseTime(iso: string): number {
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Build the flat row list for one channel's messages (already ascending by
 * `createdAt` — `selectLocalChannelMessages` guarantees that order).
 */
export function buildChannelFeedRows(
  messages: readonly LocalChannelMessage[]
): ChannelFeedRow[] {
  const rows: ChannelFeedRow[] = [];
  let currentDateKey: string | null = null;
  let previousTime: number | null = null;

  for (const message of messages) {
    const created = new Date(message.createdAt);
    const dateKey = getLocalDateKey(created);
    const time = parseTime(message.createdAt);

    if (dateKey !== currentDateKey) {
      rows.push({ kind: "divider", id: `divider-${dateKey}`, dateKey });
      currentDateKey = dateKey;
      previousTime = null;
    }

    // A tombstone always starts a fresh block: collapsing "message deleted"
    // into the block above would read as an edit of the message before it.
    const grouped =
      previousTime !== null &&
      message.deletedAt === null &&
      time - previousTime <= CHANNEL_MESSAGE_GROUPING_WINDOW_MS;

    rows.push({ kind: "message", id: message.id, message, grouped });
    previousTime = time;
  }

  return rows;
}

export type ChannelDateDividerLabel =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "date"; date: Date };

/**
 * Classify a divider's calendar day. Returning a descriptor instead of a
 * string keeps this pure and testable — the component supplies `t` for the
 * two relative days and `Intl` for the rest.
 */
export function resolveChannelDateDividerLabel(
  dateKey: string,
  now: Date = new Date()
): ChannelDateDividerLabel {
  // `dateKey` is a LOCAL calendar key ("YYYY-MM-DD"); parsing it through the
  // Date string constructor would read it as UTC midnight and shift the day
  // for negative offsets, so rebuild the local date part by part.
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  const dayDiff = getLocalDayDiff(date, now);
  if (dayDiff === 0) return { kind: "today" };
  if (dayDiff === 1) return { kind: "yesterday" };
  return { kind: "date", date };
}
