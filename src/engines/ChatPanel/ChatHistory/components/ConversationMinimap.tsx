import React, { memo, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import { normalizeUserMessageText } from "@src/engines/ChatPanel/ChatItems/normalizeUserMessageText";
import { stripExpandedPillContent } from "@src/engines/ChatPanel/InputArea/utils/pillContentParser";

import { isAssistantMessageEvent } from "../chatItemPipeline/dedup";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatGroupMeta } from "../hooks/useChatGroups";
import { getRoundPreviewText } from "../utils/turnPageFormatting";
import { getTurnTimingLabels } from "../utils/turnTimingFormatting";

export const MAX_CONVERSATION_MINIMAP_MARKERS = 20;

export function sampleConversationGroupIndices(
  groupIndices: readonly number[],
  maxMarkers = MAX_CONVERSATION_MINIMAP_MARKERS
): number[] {
  if (maxMarkers <= 0 || groupIndices.length === 0) return [];
  if (groupIndices.length <= maxMarkers) return [...groupIndices];
  if (maxMarkers === 1) return [groupIndices[groupIndices.length - 1]];

  const lastIndex = groupIndices.length - 1;
  return Array.from({ length: maxMarkers }, (_, markerIndex) => {
    const percentage = markerIndex / (maxMarkers - 1);
    return groupIndices[Math.round(percentage * lastIndex)];
  });
}

export function findNearestConversationMarker(
  markerGroupIndices: readonly number[],
  activeGroupIndex: number
): number | null {
  if (markerGroupIndices.length === 0) return null;
  return markerGroupIndices.reduce((nearest, candidate) =>
    Math.abs(candidate - activeGroupIndex) <
    Math.abs(nearest - activeGroupIndex)
      ? candidate
      : nearest
  );
}

export function resolveActiveConversationMarker(
  markerGroupIndices: readonly number[],
  activeGroupIndex: number,
  isAtBottom: boolean
): number | null {
  if (isAtBottom) return markerGroupIndices.at(-1) ?? null;
  return findNearestConversationMarker(markerGroupIndices, activeGroupIndex);
}

function getUserPreview(header: OptimizedChatItem | null): string {
  const displayText = header?.event?.displayText;
  if (typeof displayText !== "string") return "";
  return getRoundPreviewText(
    normalizeUserMessageText(stripExpandedPillContent(displayText))
  );
}

function buildAssistantPreviews(
  flatItems: readonly OptimizedChatItem[],
  groupCounts: readonly number[]
): string[] {
  let groupStartIndex = 0;
  return groupCounts.map((groupCount) => {
    const groupEndIndex = groupStartIndex + groupCount;
    let preview = "";
    for (let index = groupEndIndex - 1; index >= groupStartIndex; index--) {
      const event = flatItems[index]?.event;
      if (!event || !isAssistantMessageEvent(event)) continue;
      if (typeof event.displayText !== "string") continue;
      preview = getRoundPreviewText(event.displayText);
      if (preview) break;
    }
    groupStartIndex = groupEndIndex;
    return preview;
  });
}

interface ConversationMinimapProps {
  groupHeaders: readonly (OptimizedChatItem | null)[];
  groupMeta: readonly ChatGroupMeta[];
  groupCounts: readonly number[];
  flatItems: readonly OptimizedChatItem[];
  activeGroupIndex: number;
  isAtBottom: boolean;
  labelVariant?: "agent" | "agents";
  onNavigate: (groupIndex: number) => void;
}

const ConversationMinimap: React.FC<ConversationMinimapProps> = memo(
  ({
    groupHeaders,
    groupMeta,
    groupCounts,
    flatItems,
    activeGroupIndex,
    isAtBottom,
    labelVariant = "agent",
    onNavigate,
  }) => {
    const { t } = useTranslation();
    const tooltipId = useId();
    const [previewGroupIndex, setPreviewGroupIndex] = useState<number | null>(
      null
    );
    const navigableGroupIndices = useMemo(
      () =>
        groupHeaders.flatMap((header, groupIndex) =>
          header ? [groupIndex] : []
        ),
      [groupHeaders]
    );
    const markerGroupIndices = useMemo(
      () => sampleConversationGroupIndices(navigableGroupIndices),
      [navigableGroupIndices]
    );
    const assistantPreviews = useMemo(
      () => buildAssistantPreviews(flatItems, groupCounts),
      [flatItems, groupCounts]
    );
    const activeMarkerGroupIndex = resolveActiveConversationMarker(
      markerGroupIndices,
      activeGroupIndex,
      isAtBottom
    );
    const previewMarkerPosition =
      previewGroupIndex === null
        ? -1
        : navigableGroupIndices.indexOf(previewGroupIndex);
    const previewSampledMarkerIndex =
      previewGroupIndex === null
        ? -1
        : markerGroupIndices.indexOf(previewGroupIndex);
    const previewHeader =
      previewGroupIndex === null ? null : groupHeaders[previewGroupIndex];
    const previewTitle = getUserPreview(previewHeader);
    const previewResponse =
      previewGroupIndex === null
        ? ""
        : (assistantPreviews[previewGroupIndex] ?? "");
    const previewMeta =
      previewGroupIndex === null ? undefined : groupMeta[previewGroupIndex];
    const previewTiming = getTurnTimingLabels(
      previewMeta?.durationMs ?? 0,
      previewMeta?.startMs ?? null,
      previewMeta?.endMs ?? null
    );
    const showTiming =
      previewMeta !== undefined &&
      (previewMeta.durationMs > 0 || previewTiming.showRange);
    const durationLabel = t(
      labelVariant === "agents"
        ? "sessions:tools.turnCollapse.agentsWorkedFor"
        : "sessions:tools.turnCollapse.agentWorkedFor",
      { value: previewTiming.duration }
    );
    const timeRangeLabel = previewTiming.showRange
      ? t("sessions:tools.turnCollapse.timeRange", {
          start: previewTiming.startClock,
          end: previewTiming.endClock,
        })
      : "";
    const previewFallback =
      previewMarkerPosition >= 0
        ? t("common:pagination.round", {
            current: previewMarkerPosition + 1,
          })
        : "";

    if (markerGroupIndices.length < 2) return null;

    return (
      <nav
        aria-label={t(
          "sessions:chat.conversationNavigator",
          "Conversation navigator"
        )}
        className="pointer-events-auto absolute left-2 top-1/2 z-40 hidden h-60 -translate-y-1/2 flex-col justify-between @[640px]/chatbody:flex"
        onMouseLeave={() => setPreviewGroupIndex(null)}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setPreviewGroupIndex(null);
          }
        }}
      >
        {markerGroupIndices.map((groupIndex, markerIndex) => {
          const turnPosition = navigableGroupIndices.indexOf(groupIndex) + 1;
          const prompt = getUserPreview(groupHeaders[groupIndex]);
          const isActive = groupIndex === activeMarkerGroupIndex;
          const distanceFromPreview = Math.abs(
            markerIndex - previewSampledMarkerIndex
          );
          const widthClass =
            previewSampledMarkerIndex < 0 || distanceFromPreview > 1
              ? "w-2"
              : distanceFromPreview === 1
                ? "w-3"
                : "w-4";
          return (
            <div
              key={groupIndex}
              className="relative flex h-3 w-12 shrink-0 items-center"
            >
              <button
                type="button"
                aria-current={isActive ? "step" : undefined}
                aria-describedby={
                  previewGroupIndex === groupIndex ? tooltipId : undefined
                }
                aria-label={t("sessions:chat.goToConversationTurn", {
                  defaultValue:
                    "Go to turn {{current}} of {{total}}: {{preview}}",
                  current: turnPosition,
                  total: navigableGroupIndices.length,
                  preview:
                    prompt ||
                    t("common:pagination.round", { current: turnPosition }),
                })}
                className="group flex h-3 w-12 cursor-pointer items-center border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30"
                onClick={() => onNavigate(groupIndex)}
                onMouseEnter={() => setPreviewGroupIndex(groupIndex)}
                onFocus={() => setPreviewGroupIndex(groupIndex)}
              >
                <span
                  className={`h-[3px] ${widthClass} transition-[width,background-color] duration-150 motion-reduce:transition-none ${
                    isActive
                      ? "bg-primary-6"
                      : "bg-text-3/40 group-hover:bg-text-2 group-focus-visible:bg-text-2"
                  }`}
                />
              </button>

              {previewGroupIndex === groupIndex && (
                <div
                  id={tooltipId}
                  role="tooltip"
                  className={`${DROPDOWN_CLASSES.panel} pointer-events-none absolute left-4 top-1/2 ml-1 w-80 -translate-y-1/2 p-3 text-left`}
                >
                  <div className="truncate text-sm font-medium text-text-1">
                    {previewTitle || previewFallback}
                  </div>
                  {previewResponse && (
                    <div className="mt-1 line-clamp-3 text-sm leading-5 text-text-3">
                      {previewResponse}
                    </div>
                  )}
                  {showTiming && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-2/60 pt-2 text-xs text-text-3">
                      <span className="font-medium text-text-2">
                        {durationLabel}
                      </span>
                      {timeRangeLabel && <span>{timeRangeLabel}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    );
  }
);

ConversationMinimap.displayName = "ConversationMinimap";

export default ConversationMinimap;
