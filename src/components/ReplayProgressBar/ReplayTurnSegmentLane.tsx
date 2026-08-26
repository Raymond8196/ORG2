import React, { memo, useCallback } from "react";

import Tooltip from "@src/components/Tooltip";

import type { ReplayProgressSegment } from "./types";

export interface ReplayTurnSegmentLaneProps {
  segments: readonly ReplayProgressSegment[];
  max: number;
  onSegmentClick?: (segment: ReplayProgressSegment) => void;
}

function getSegmentBandSpan(
  segment: ReplayProgressSegment,
  nextSegment: ReplayProgressSegment | undefined,
  max: number
): { widthPercent: number } {
  if (max <= 0) return { widthPercent: 0 };

  const displayEnd = nextSegment?.startValue ?? max;
  const rawWidth = ((displayEnd - segment.startValue) / max) * 100;
  return {
    widthPercent: Math.max(rawWidth, 0.75),
  };
}

const ReplayTurnSegmentLane: React.FC<ReplayTurnSegmentLaneProps> = memo(
  ({ segments, max, onSegmentClick }) => {
    const handleClick = useCallback(
      (segment: ReplayProgressSegment) => (event: React.MouseEvent) => {
        event.stopPropagation();
        onSegmentClick?.(segment);
      },
      [onSegmentClick]
    );

    if (segments.length <= 1) return null;

    return (
      <div
        className="replay-progress-bar__segments mx-2 mt-1 flex h-1.5 overflow-hidden rounded-sm"
        role="list"
        aria-label="Replay turns"
      >
        {segments.map((segment, index) => {
          const { widthPercent } = getSegmentBandSpan(
            segment,
            segments[index + 1],
            max
          );

          return (
            <Tooltip key={segment.id} content={segment.tooltip} position="top">
              <button
                type="button"
                role="listitem"
                data-testid="replay-turn-segment"
                data-active={segment.isActive ? "true" : undefined}
                data-color-index={segment.colorIndex % 6}
                aria-label={segment.ariaLabel}
                className="replay-progress-bar__segment h-full min-w-[2px] border-0 p-0 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-6/40"
                style={{ width: `${widthPercent}%` }}
                onClick={handleClick(segment)}
              />
            </Tooltip>
          );
        })}
      </div>
    );
  }
);

ReplayTurnSegmentLane.displayName = "ReplayTurnSegmentLane";

export default ReplayTurnSegmentLane;
