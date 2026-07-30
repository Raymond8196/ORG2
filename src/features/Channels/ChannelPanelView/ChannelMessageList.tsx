/**
 * Virtualized channel transcript.
 *
 * Same construction as `HumanSessionView`: a `useVirtualizer` over a flat row
 * list, THRESHOLD-GATED so short transcripts render plainly (a virtualizer
 * over ten rows costs measurement passes and buys nothing, and plain rendering
 * keeps the DOM inspectable in tests), with `measureElement` handling the
 * dynamic heights markdown bodies produce. Rows are keyed by message id via
 * `getItemKey` so editing a body re-measures that row instead of shifting the
 * window.
 *
 * Date dividers are ordinary rows in the same index space (see
 * `channelFeedRows.ts`) — the virtualizer needs one flat list.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useMemo, useRef } from "react";

import type { LocalChannelMessage } from "@src/store/ui/localChannelMessagesAtom";

import ChannelMessageRow, { ChannelDateDivider } from "./ChannelMessageRow";
import {
  buildChannelFeedRows,
  resolveChannelDateDividerLabel,
} from "./channelFeedRows";

/** Below this row count the list renders plainly (no virtualizer). */
export const CHANNEL_VIRTUALIZATION_THRESHOLD = 30;
/** First-pass row height; `measureElement` corrects it per row. */
export const CHANNEL_ESTIMATED_ROW_HEIGHT = 64;

export interface ChannelMessageListProps {
  messages: readonly LocalChannelMessage[];
  authorLabel: string;
  onEdit: ((messageId: string, body: string) => boolean) | null;
  onDelete: ((messageId: string) => void) | null;
}

const ChannelMessageList: React.FC<ChannelMessageListProps> = ({
  messages,
  authorLabel,
  onEdit,
  onDelete,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => buildChannelFeedRows(messages), [messages]);
  const rowCount = rows.length;
  const shouldVirtualize = rowCount > CHANNEL_VIRTUALIZATION_THRESHOLD;

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual exposes imperative helpers that cannot be memoized safely.
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? rowCount : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => CHANNEL_ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 8,
  });

  // Auto-scroll to the newest row, the transcript's resting position. Keyed
  // on the row count so a new post lands in view; an edit does not scroll.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (shouldVirtualize && rowCount > 0) {
        rowVirtualizer.scrollToIndex(rowCount - 1, { align: "end" });
        return;
      }
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [rowCount, rowVirtualizer, shouldVirtualize]);

  const renderRow = (index: number): React.ReactNode => {
    const row = rows[index];
    if (!row) return null;
    if (row.kind === "divider") {
      return (
        <ChannelDateDivider
          label={resolveChannelDateDividerLabel(row.dateKey)}
        />
      );
    }
    return (
      <ChannelMessageRow
        message={row.message}
        grouped={row.grouped}
        authorLabel={authorLabel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  };

  return (
    <div
      ref={scrollContainerRef}
      className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto"
      data-testid="channel-message-list"
    >
      <div className="py-2">
        {shouldVirtualize ? (
          <div
            className="relative min-w-0"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={rows[virtualRow.index].id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {renderRow(virtualRow.index)}
              </div>
            ))}
          </div>
        ) : (
          rows.map((row, index) => (
            <React.Fragment key={row.id}>{renderRow(index)}</React.Fragment>
          ))
        )}
      </div>
    </div>
  );
};

export default ChannelMessageList;
