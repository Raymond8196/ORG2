/**
 * EditActivityGroup
 *
 * Groups file edits and the reads performed after them into one collapsible
 * stack. Each event still renders through the event registry.
 */
import React, { Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getToolIcon } from "@src/config/toolIcons";
import ToolUsageBadge from "@src/engines/ChatPanel/blocks/ToolCallBlock/ToolUsageBadge";
import { StackedBlock } from "@src/engines/ChatPanel/blocks/primitives";
import {
  type SessionEvent,
  TOOL_USAGE_ARGS_KEY,
  type ToolUsageMetadata,
} from "@src/engines/SessionCore/core/types";
import { getChatLazyComponent } from "@src/engines/SessionCore/rendering/registry/events";
import {
  getRegistryEventType,
  normalizeFunctionName,
} from "@src/lib/activityData/activityNormalizers";

interface EditActivityGroupProps {
  events: SessionEvent[];
  closedByBoundary?: boolean;
}

interface EditEventItem {
  event: SessionEvent;
  isLastItem: boolean;
}

function getCanonicalName(event: SessionEvent): string {
  return (
    event.uiCanonical ||
    normalizeFunctionName(event.functionName || event.actionType || "")
  );
}

export function countActivities(
  events: readonly SessionEvent[],
  kind: "edit" | "read"
): number {
  return events.reduce((count, event) => {
    const canonical = getCanonicalName(event);
    const matches =
      kind === "edit"
        ? canonical === "edit_file" || canonical === "delete_file"
        : canonical === "read_file";
    return matches ? count + 1 : count;
  }, 0);
}

const ActivityBlockFallback: React.FC = () => (
  <div className="h-6 animate-pulse rounded bg-fill-2" />
);

function ActivityBlock({ event }: { event: SessionEvent }) {
  const eventType = getRegistryEventType(
    event as unknown as Record<string, unknown>
  );
  const EventComponent = getChatLazyComponent(eventType);
  return (
    <Suspense fallback={<ActivityBlockFallback />}>
      {React.createElement(EventComponent, { event })}
    </Suspense>
  );
}

function suppressLoadingForNonLastRunningEvent(
  event: SessionEvent,
  isLastItem: boolean
): SessionEvent {
  if (isLastItem || event.displayStatus !== "running") return event;
  return {
    ...event,
    displayStatus: "completed",
    activityStatus: "processed",
    isDelta: false,
  };
}

function readToolUsage(event: SessionEvent): ToolUsageMetadata | undefined {
  if (event.toolUsage) return event.toolUsage;
  const raw = event.args?.[TOOL_USAGE_ARGS_KEY];
  if (!raw || typeof raw !== "object") return undefined;
  return raw as ToolUsageMetadata;
}

function aggregateToolUsage(
  items: readonly EditEventItem[]
): ToolUsageMetadata | undefined {
  const usages = items
    .map((item) => readToolUsage(item.event))
    .filter((usage): usage is ToolUsageMetadata => Boolean(usage));
  if (usages.length === 0) return undefined;

  return usages.reduce<ToolUsageMetadata>(
    (total, usage) => ({
      decisionCompletionTokens:
        total.decisionCompletionTokens + usage.decisionCompletionTokens,
      resultContextTokens:
        total.resultContextTokens + usage.resultContextTokens,
      followupCompletionTokens:
        total.followupCompletionTokens + usage.followupCompletionTokens,
      inputBytes: total.inputBytes + usage.inputBytes,
      outputBytes: total.outputBytes + usage.outputBytes,
      relatedCacheReadTokens:
        total.relatedCacheReadTokens + usage.relatedCacheReadTokens,
      relatedCacheWriteTokens:
        total.relatedCacheWriteTokens + usage.relatedCacheWriteTokens,
      attributionMethod:
        total.attributionMethod === usage.attributionMethod
          ? total.attributionMethod
          : usage.attributionMethod,
    }),
    {
      decisionCompletionTokens: 0,
      resultContextTokens: 0,
      followupCompletionTokens: 0,
      inputBytes: 0,
      outputBytes: 0,
      relatedCacheReadTokens: 0,
      relatedCacheWriteTokens: 0,
      attributionMethod: usages[0].attributionMethod,
    }
  );
}

function renderEditEvent({ event, isLastItem }: EditEventItem) {
  return (
    <ActivityBlock
      event={suppressLoadingForNonLastRunningEvent(event, isLastItem)}
    />
  );
}

const EditActivityGroup: React.FC<EditActivityGroupProps> = ({
  events,
  closedByBoundary = true,
}) => {
  const { t } = useTranslation("sessions");
  const items = useMemo<EditEventItem[]>(
    () =>
      events.map((event, index) => ({
        event,
        isLastItem: index === events.length - 1,
      })),
    [events]
  );

  if (items.length === 0) return null;

  const editCount = countActivities(events, "edit");
  const readCount = countActivities(events, "read");
  const summaryParts = [t("tools.editSummary.edit", { count: editCount })];
  if (readCount > 0) {
    summaryParts.push(t("tools.editSummary.read", { count: readCount }));
  }

  const firstEvent = items[0].event;
  const groupToolUsage = aggregateToolUsage(items);

  return (
    <div
      data-tool-call-event-id={firstEvent.id}
      data-tool-call-name={
        firstEvent.functionName ||
        firstEvent.uiCanonical ||
        firstEvent.actionType
      }
    >
      <StackedBlock
        items={items}
        icon={getToolIcon("edit_file", {
          size: 14,
          className: "text-text-2",
        })}
        label={t("tools.editFiles")}
        groupSummary={summaryParts.join(t("tools.editSummary.separator"))}
        defaultCollapsed={closedByBoundary}
        collapseWhen={closedByBoundary}
        eventId={firstEvent.id}
        rightContent={
          groupToolUsage ? <ToolUsageBadge usage={groupToolUsage} /> : undefined
        }
        renderItem={renderEditEvent}
      />
    </div>
  );
};

EditActivityGroup.displayName = "EditActivityGroup";

export default EditActivityGroup;
