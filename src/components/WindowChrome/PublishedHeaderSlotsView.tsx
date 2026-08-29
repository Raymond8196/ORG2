import type { ReactNode } from "react";
import React, { memo } from "react";

import { HEADER_CONTENT_LEFT_PADDING_CLASS } from "@src/config/workstation/tokens";

import { NoDragRegion } from "./NoDragRegion";

/** Shared slot shape for the 40px published header bars. */
export interface PublishedHeaderSlots {
  leading?: ReactNode;
  content?: ReactNode;
  trailing?: ReactNode;
  /** Visually joins this 40px header to a following pane-owned row. */
  joinWithFollowingRow?: boolean;
}

const DRAG_STYLE = { WebkitAppRegion: "drag" } as React.CSSProperties;

interface PublishedHeaderSlotsViewProps {
  slots: PublishedHeaderSlots | null;
  /** Left inset for host-specific chrome alignment. */
  paddingLeftClassName?: string;
  /**
   * Hand the space after `content` to the host window as a drag handle
   * instead of stretching `content` across it.
   *
   * `content` normally carries the `flex-1`, which makes the whole middle of
   * the row one no-drag region. That is fine while a tab bar sits above and
   * owns dragging, but a row that is its own pane's only chrome has to offer
   * a handle of its own — exactly as the tab strip does, where the strip is
   * draggable and only the pills opt out.
   */
  dragFiller?: boolean;
}

/**
 * Renders pane-owned controls into a shell-owned header row. My Station,
 * Agent Station replay, and the chat pane share this exact slot layout.
 */
export const PublishedHeaderSlotsView: React.FC<PublishedHeaderSlotsViewProps> =
  memo(
    ({
      slots,
      paddingLeftClassName = HEADER_CONTENT_LEFT_PADDING_CLASS,
      dragFiller = false,
    }) => {
      return (
        <div
          className={`flex min-w-0 flex-1 items-center ${paddingLeftClassName}`}
        >
          {slots?.leading && (
            <NoDragRegion className="flex shrink-0 items-center">
              {slots.leading}
            </NoDragRegion>
          )}
          <NoDragRegion
            className={`flex min-w-0 items-center ${dragFiller ? "" : "flex-1"}`}
          >
            {slots?.content}
          </NoDragRegion>
          {dragFiller && (
            <div
              className="h-full min-w-0 flex-1"
              data-tauri-drag-region
              data-testid="published-header-drag-filler"
              style={DRAG_STYLE}
              aria-hidden
            />
          )}
          {slots?.trailing && (
            <NoDragRegion className="flex shrink-0 items-center gap-px">
              {slots.trailing}
            </NoDragRegion>
          )}
        </div>
      );
    }
  );

PublishedHeaderSlotsView.displayName = "PublishedHeaderSlotsView";
