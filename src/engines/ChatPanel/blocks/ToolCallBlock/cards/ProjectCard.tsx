import BookOpen from "@hugeicons/core-free-icons/BookOpen01Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar01Icon";
import XCircle from "@hugeicons/core-free-icons/CancelCircleIcon";
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Circle from "@hugeicons/core-free-icons/CircleIcon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import Heart from "@hugeicons/core-free-icons/FavouriteIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { ProjectCardData, WorkItemStatus } from "../types";
import { ToolResultCardFrame } from "./ToolResultCardFrame";

function getStatusIcon(status: WorkItemStatus | string): React.ReactNode {
  switch (status) {
    case "in_progress":
      return (
        <HugeiconsIcon icon={Clock} size={13} className="text-primary-6" />
      );
    case "done":
      return (
        <HugeiconsIcon
          icon={CheckCircle2}
          size={13}
          className="text-success-6"
        />
      );
    case "cancelled":
      return <HugeiconsIcon icon={XCircle} size={13} className="text-text-4" />;
    default:
      return <HugeiconsIcon icon={Circle} size={13} className="text-text-4" />;
  }
}

function getStatusLabel(status: WorkItemStatus | string): string {
  const map: Record<string, string> = {
    todo: "Todo",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
    cancelled: "Cancelled",
    backlog: "Backlog",
  };
  return map[status] ?? String(status);
}

function getHealthColor(health: string): string {
  switch (health.toLowerCase()) {
    case "on_track":
    case "on track":
      return "text-success-6";
    case "at_risk":
    case "at risk":
      return "text-warning-6";
    case "off_track":
    case "off track":
      return "text-danger-6";
    default:
      return "text-text-4";
  }
}

interface ProjectCardProps {
  card: ProjectCardData;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ card }) => {
  return (
    <ToolResultCardFrame>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-primary-6">
          <HugeiconsIcon icon={BookOpen} size={13} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="chat-block-content truncate font-medium text-text-1">
              {card.name}
            </span>
            {getStatusIcon(card.status)}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-4">
            <span>{getStatusLabel(card.status)}</span>

            {card.slug && (
              <>
                <span>·</span>
                <span className="truncate font-mono text-[10px]">
                  {card.slug}
                </span>
              </>
            )}

            {card.workItemCount !== undefined && (
              <>
                <span>·</span>
                <span className="shrink-0">
                  {card.workItemCount}{" "}
                  {card.workItemCount === 1 ? "item" : "items"}
                </span>
              </>
            )}

            {card.targetDate && (
              <>
                <span>·</span>
                <span className="inline-flex shrink-0 items-center gap-0.5">
                  <HugeiconsIcon icon={Calendar} size={10} />
                  {card.targetDate}
                </span>
              </>
            )}

            {card.health && (
              <>
                <span>·</span>
                <span
                  className={`inline-flex shrink-0 items-center gap-0.5 ${getHealthColor(card.health)}`}
                >
                  <HugeiconsIcon icon={Heart} size={10} />
                  {card.health.replace(/_/g, " ")}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </ToolResultCardFrame>
  );
};

ProjectCard.displayName = "ProjectCard";

export default ProjectCard;
