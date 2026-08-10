import { ChevronRight } from "lucide-react";
import React, { Children, forwardRef } from "react";

import { PILL_CONTROL_IDLE_SURFACE_CLASS } from "@src/components/CompoundPill/config";

export type LaunchpadActionTone = "primary" | "neutral" | "success" | "warning";
export type LaunchpadActionPresentation = "card" | "pill";

export interface LaunchpadAction {
  id: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  tone: LaunchpadActionTone;
}

const ACTION_TONE_CLASS: Record<LaunchpadActionTone, string> = {
  primary:
    "border-primary-6/20 bg-primary-6/5 hover:border-primary-6/30 hover:bg-primary-6/10",
  neutral: `border-border-2 hover:border-border-3 ${PILL_CONTROL_IDLE_SURFACE_CLASS}`,
  success:
    "border-success-6/20 bg-success-6/5 hover:border-success-6/30 hover:bg-success-6/10",
  warning:
    "border-warning-6/20 bg-warning-6/5 hover:border-warning-6/30 hover:bg-warning-6/10",
};

const ACTION_CARD_TONE_CLASS: Record<LaunchpadActionTone, string> = {
  primary:
    "border-primary-6/20 hover:border-primary-6/30 hover:bg-surface-hover",
  neutral: "border-border-2 hover:border-border-3 hover:bg-surface-hover",
  success:
    "border-success-6/20 hover:border-success-6/30 hover:bg-surface-hover",
  warning:
    "border-warning-6/20 hover:border-warning-6/30 hover:bg-surface-hover",
};

const ACTION_ICON_TONE_CLASS: Record<LaunchpadActionTone, string> = {
  primary: "text-primary-6",
  neutral: "text-text-2",
  success: "text-success-6",
  warning: "text-warning-6",
};

interface LaunchpadActionCardProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> {
  action: LaunchpadAction;
  presentation?: LaunchpadActionPresentation;
}

export const LaunchpadActionCard = forwardRef<
  HTMLButtonElement,
  LaunchpadActionCardProps
>(function LaunchpadActionCard(
  { action, presentation = "pill", ...buttonProps },
  ref
) {
  if (presentation === "card") {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        className={`group flex min-h-[68px] w-full flex-col items-start justify-between rounded-lg border bg-transparent px-2.5 py-2 text-left shadow-sm transition-colors focus-visible:border-primary-6 focus-visible:outline-none ${ACTION_CARD_TONE_CLASS[action.tone]}`}
        onClick={action.onClick}
        data-testid={
          buttonProps["data-testid"] ?? `chat-panel-start-page-${action.id}`
        }
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center ${ACTION_ICON_TONE_CLASS[action.tone]}`}
        >
          {action.icon}
        </span>
        <span className="block text-[12px] font-medium leading-4 text-text-1">
          {action.title}
        </span>
      </button>
    );
  }

  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      className={`group flex w-full items-center gap-2 rounded-full border px-2 py-1.5 text-left transition-colors focus-visible:border-primary-6 focus-visible:outline-none ${ACTION_TONE_CLASS[action.tone]}`}
      onClick={action.onClick}
      data-testid={
        buttonProps["data-testid"] ?? `chat-panel-start-page-${action.id}`
      }
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-2 text-text-2 transition-colors ${
          action.tone === "warning" ? "group-hover:bg-fill-3" : ""
        }`}
      >
        {action.icon}
      </span>
      <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
        {action.title}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
});

interface LaunchpadActionGridProps {
  cardWidthClassName?: string;
  children: React.ReactNode;
  className?: string;
  layoutActionCount?: number;
  presentation?: LaunchpadActionPresentation;
}

export function LaunchpadActionGrid({
  cardWidthClassName,
  children,
  className = "",
  layoutActionCount,
  presentation = "pill",
}: LaunchpadActionGridProps): React.ReactNode {
  const actionCount = layoutActionCount ?? Children.count(children);
  const cardWidthClass =
    cardWidthClassName ??
    (actionCount >= 4
      ? "max-w-[600px]"
      : actionCount === 3
        ? "max-w-[480px]"
        : "max-w-[320px]");
  const cardColumnClass =
    actionCount >= 4
      ? "@[560px]/startactions:grid-cols-4"
      : actionCount === 3
        ? "@[440px]/startactions:grid-cols-3"
        : "";

  return (
    <div
      className={`@container/startactions ${
        presentation === "card"
          ? `hidden @[640px]/focusedchat:block ${cardWidthClass}`
          : ""
      } ${className}`}
    >
      <div
        className={
          presentation === "card"
            ? `grid grid-cols-1 gap-2 @[300px]/startactions:grid-cols-2 ${cardColumnClass}`
            : "grid grid-cols-1 gap-3 @[420px]/startactions:grid-cols-2 @[800px]/startactions:grid-cols-3"
        }
      >
        {children}
      </div>
    </div>
  );
}
