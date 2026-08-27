/**
 * GanttTaskTooltip Component
 *
 * Hover tooltip for task bars showing detailed information and quick actions.
 * Uses useDropdownEngine + portal with DROPDOWN_CLASSES tokens.
 */
import TrendingDown from "@hugeicons/core-free-icons/AnalyticsDownIcon";
import TrendingUp from "@hugeicons/core-free-icons/AnalyticsUpIcon";
import Calendar from "@hugeicons/core-free-icons/Calendar01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import Edit2 from "@hugeicons/core-free-icons/Edit02Icon";
import Minus from "@hugeicons/core-free-icons/MinusSignIcon";
import User from "@hugeicons/core-free-icons/UserIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React, { useCallback, useRef } from "react";
import { createPortal } from "react-dom";

import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";

import type { GanttTask } from "../../types";
import {
  calculateExpectedProgress,
  calculateProgressHealth,
  getProgressHealthColor,
} from "../../utils/progress";
import "./index.scss";

export interface GanttTaskTooltipProps {
  task: GanttTask;
  children: React.ReactElement;
  onEdit?: (task: GanttTask) => void;
  onDelete?: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: GanttTask["status"]) => void;
}

const HOVER_CLOSE_DELAY = 150;

const GanttTaskTooltip: React.FC<GanttTaskTooltipProps> = ({
  task,
  children,
  onEdit,
  onDelete,
  onStatusChange,
}) => {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const {
    isOpen,
    isPositioned,
    setIsOpen,
    triggerRef,
    panelRef,
    panelPosition,
    updatePosition,
  } = useDropdownEngine<HTMLDivElement>({
    placement: "top",
    closeOnClickOutside: false,
    closeOnEsc: true,
    gap: 8,
  });

  const showPanel = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    if (!isOpen) {
      updatePosition();
      setIsOpen(true);
    }
  }, [isOpen, setIsOpen, updatePosition]);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, HOVER_CLOSE_DELAY);
  }, [setIsOpen]);

  const formatDate = (date: Date | string): string => {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusLabel = (status?: GanttTask["status"]): string => {
    switch (status) {
      case "not_started":
        return "Not Started";
      case "in_progress":
        return "In Progress";
      case "completed":
        return "Completed";
      case "overdue":
        return "Overdue";
      case "cancelled":
        return "Cancelled";
      default:
        return "Unknown";
    }
  };

  const getStatusColor = (status?: GanttTask["status"]): string => {
    switch (status) {
      case "not_started":
        return "#6b7280";
      case "in_progress":
        return "#3b82f6";
      case "completed":
        return "#10b981";
      case "overdue":
        return "#ef4444";
      case "cancelled":
        return "#9ca3af";
      default:
        return "#6b7280";
    }
  };

  const getProgressHealthIcon = (health: string) => {
    switch (health) {
      case "ahead":
        return <HugeiconsIcon icon={TrendingUp} size={14} />;
      case "behind":
        return <HugeiconsIcon icon={TrendingDown} size={14} />;
      default:
        return <HugeiconsIcon icon={Minus} size={14} />;
    }
  };

  const getProgressHealthLabel = (health: string): string => {
    switch (health) {
      case "ahead":
        return "Ahead of Schedule";
      case "on-track":
        return "On Track";
      case "at-risk":
        return "At Risk";
      case "behind":
        return "Behind Schedule";
      default:
        return "";
    }
  };

  const expectedProgress = calculateExpectedProgress(
    task.startDate,
    task.endDate
  );
  const actualProgress = task.progress || 0;
  const progressHealth = calculateProgressHealth(
    actualProgress,
    expectedProgress
  );
  const healthColor = getProgressHealthColor(progressHealth);

  const handleStatusCycle = () => {
    if (!onStatusChange) return;

    const statusFlow: GanttTask["status"][] = [
      "not_started",
      "in_progress",
      "completed",
    ];
    const currentIndex = statusFlow.indexOf(task.status || "not_started");
    const nextStatus = statusFlow[(currentIndex + 1) % statusFlow.length];

    onStatusChange(task.id, nextStatus);
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    ...(panelPosition.top != null ? { top: panelPosition.top } : {}),
    ...(panelPosition.bottom != null ? { bottom: panelPosition.bottom } : {}),
    left: panelPosition.left,
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleClose}
        className="inline-block"
      >
        {children}
      </div>

      {isOpen &&
        isPositioned &&
        createPortal(
          <div
            ref={panelRef}
            className={`${DROPDOWN_CLASSES.panel} gantt-task-tooltip-panel`}
            style={panelStyle}
            onMouseEnter={showPanel}
            onMouseLeave={scheduleClose}
          >
            <div className="gantt-task-tooltip">
              {/* Header */}
              <div className="gantt-task-tooltip__header">
                <h4 className="gantt-task-tooltip__title">{task.title}</h4>
              </div>

              {/* Details */}
              <div className="gantt-task-tooltip__body">
                <div className="gantt-task-tooltip__row">
                  <HugeiconsIcon
                    icon={Calendar}
                    size={14}
                    className="gantt-task-tooltip__icon"
                  />
                  <span className="gantt-task-tooltip__label">
                    {formatDate(task.startDate)} → {formatDate(task.endDate)}
                  </span>
                </div>

                {task.assignee && (
                  <div className="gantt-task-tooltip__row">
                    <HugeiconsIcon
                      icon={User}
                      size={14}
                      className="gantt-task-tooltip__icon"
                    />
                    <span className="gantt-task-tooltip__label">
                      {task.assignee}
                    </span>
                  </div>
                )}

                <div className="gantt-task-tooltip__row">
                  <div
                    className="gantt-task-tooltip__status-badge"
                    style={{ backgroundColor: getStatusColor(task.status) }}
                    onClick={onStatusChange ? handleStatusCycle : undefined}
                    title={onStatusChange ? "Click to cycle status" : undefined}
                  >
                    {getStatusLabel(task.status)}
                  </div>
                </div>

                {task.progress !== undefined && (
                  <>
                    <div className="gantt-task-tooltip__row">
                      <span className="gantt-task-tooltip__label">
                        Progress
                      </span>
                      <div className="gantt-task-tooltip__progress-bar">
                        <div
                          className="gantt-task-tooltip__progress-fill"
                          style={{
                            width: `${task.progress}%`,
                            backgroundColor: healthColor,
                          }}
                        />
                      </div>
                      <span className="gantt-task-tooltip__progress-text">
                        {task.progress}%
                      </span>
                    </div>
                    {task.status === "in_progress" && (
                      <div className="gantt-task-tooltip__row">
                        <div
                          className="gantt-task-tooltip__health-badge"
                          style={{ color: healthColor }}
                        >
                          {getProgressHealthIcon(progressHealth)}
                          <span>{getProgressHealthLabel(progressHealth)}</span>
                        </div>
                        <span className="gantt-task-tooltip__health-text">
                          Expected: {expectedProgress}%
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Actions */}
              {(onEdit || onDelete) && (
                <div className="gantt-task-tooltip__footer">
                  {onEdit && (
                    <button
                      className="gantt-task-tooltip__action"
                      onClick={() => {
                        onEdit(task);
                        setIsOpen(false);
                      }}
                      title="Edit task"
                    >
                      <HugeiconsIcon icon={Edit2} size={14} />
                      <span>Edit</span>
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="gantt-task-tooltip__action gantt-task-tooltip__action--danger"
                      onClick={() => {
                        onDelete(task.id);
                        setIsOpen(false);
                      }}
                      title="Delete task"
                    >
                      <HugeiconsIcon icon={Trash2} size={14} />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default GanttTaskTooltip;
