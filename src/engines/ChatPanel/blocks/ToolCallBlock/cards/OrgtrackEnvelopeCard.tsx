import { useSetAtom } from "jotai";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { workItemDataToUI } from "@src/api/http/project";
import { openWorkItemInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  type ChatPanelSelectedWorkItem,
  activeStationChatVisibleAtom,
} from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

import type { OrgtrackEnvelopeData } from "../types";
import {
  ToolResultCardFrame,
  ToolResultCardFrameButton,
} from "./ToolResultCardFrame";

interface OrgtrackEnvelopeCardProps {
  card: OrgtrackEnvelopeData;
}

export function buildCreatedWorkItemSelection(
  card: OrgtrackEnvelopeData
): ChatPanelSelectedWorkItem | null {
  if (
    !card.ok ||
    card.operationId !== "work.create" ||
    !card.workItem ||
    (!card.isStandalone && !card.projectSlug)
  ) {
    return null;
  }

  const workItem = workItemDataToUI(card.workItem, {
    labelMap: new Map(),
    memberMap: new Map(),
  });
  return {
    workItem,
    shortId: card.workItem.frontmatter.short_id,
    projectId: card.isStandalone
      ? ""
      : (card.projectId ?? card.workItem.frontmatter.project ?? ""),
    projectSlug: card.isStandalone ? "" : (card.projectSlug ?? ""),
    projectName: card.isStandalone
      ? ""
      : (card.projectName ?? card.projectSlug ?? ""),
    orgId: card.orgId,
  };
}

const OrgtrackEnvelopeCard: React.FC<OrgtrackEnvelopeCardProps> = ({
  card,
}) => {
  const { t } = useTranslation("common");
  const openWorkItem = useSetAtom(openWorkItemInChatPanelTabAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
  const selection = useMemo(() => buildCreatedWorkItemSelection(card), [card]);
  const handleOpen = useCallback(() => {
    if (!selection) return;
    setStationMode("my-station");
    setStationChatVisible("my-station", true);
    openWorkItem(selection);
  }, [openWorkItem, selection, setStationChatVisible, setStationMode]);
  const detail = card.ok
    ? card.itemCount !== undefined
      ? `${card.itemCount} item${card.itemCount === 1 ? "" : "s"}`
      : [card.shortId, card.title, card.status ? `→ ${card.status}` : null]
          .filter(Boolean)
          .join(" · ")
    : (card.errorMessage ?? card.errorCode ?? "error");

  const content = (
    <>
      <div className="flex items-center gap-2 border-b border-fill-4 px-3 py-2">
        {card.ok ? (
          <CheckCircle2 size={12} className="shrink-0 text-success-6" />
        ) : (
          <XCircle size={12} className="shrink-0 text-danger-6" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-2">
          {card.operation}
        </span>
        {!card.ok && card.errorCode ? (
          <span className="shrink-0 text-xs text-danger-6">
            {card.errorCode}
            {card.retryable ? " · retryable" : ""}
          </span>
        ) : null}
        {selection ? (
          <ChevronRight
            size={14}
            className="shrink-0 text-text-4"
            aria-hidden
          />
        ) : null}
      </div>
      {detail ? (
        <div className="px-3 py-2">
          <p className="chat-block-content text-xs text-text-2">{detail}</p>
        </div>
      ) : null}
    </>
  );

  if (selection) {
    return (
      <ToolResultCardFrameButton
        padded={false}
        className="overflow-hidden"
        data-testid="created-work-item-card"
        data-work-item-id={selection.shortId}
        aria-label={`${t("teamInbox.actions.openWorkItem")}: ${selection.shortId}`}
        onClick={handleOpen}
      >
        {content}
      </ToolResultCardFrameButton>
    );
  }

  return (
    <ToolResultCardFrame
      padded={false}
      hoverable={false}
      className="overflow-hidden"
    >
      {content}
    </ToolResultCardFrame>
  );
};

OrgtrackEnvelopeCard.displayName = "OrgtrackEnvelopeCard";

export default OrgtrackEnvelopeCard;
