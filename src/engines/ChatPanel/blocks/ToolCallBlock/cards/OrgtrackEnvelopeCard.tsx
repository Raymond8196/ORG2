import { CheckCircle2, XCircle } from "lucide-react";
import React from "react";

import type { OrgtrackEnvelopeData } from "../types";
import { ToolResultCardFrame } from "./ToolResultCardFrame";

interface OrgtrackEnvelopeCardProps {
  card: OrgtrackEnvelopeData;
}

const OrgtrackEnvelopeCard: React.FC<OrgtrackEnvelopeCardProps> = ({
  card,
}) => {
  const detail = card.ok
    ? card.itemCount !== undefined
      ? `${card.itemCount} item${card.itemCount === 1 ? "" : "s"}`
      : [card.shortId, card.title, card.status ? `→ ${card.status}` : null]
          .filter(Boolean)
          .join(" · ")
    : (card.errorMessage ?? card.errorCode ?? "error");

  return (
    <ToolResultCardFrame
      padded={false}
      hoverable={false}
      className="overflow-hidden"
    >
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
      </div>
      {detail ? (
        <div className="px-3 py-2">
          <p className="chat-block-content text-xs text-text-2">{detail}</p>
        </div>
      ) : null}
    </ToolResultCardFrame>
  );
};

OrgtrackEnvelopeCard.displayName = "OrgtrackEnvelopeCard";

export default OrgtrackEnvelopeCard;
