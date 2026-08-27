/**
 * SpotlightFooterAction Component
 *
 * Small clickable pill rendered alongside the keyboard-shortcuts footer.
 */
import ArrowUpRight from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

export interface SpotlightFooterActionProps {
  label: string;
  onClick: () => void;
}

export const SpotlightFooterAction: React.FC<SpotlightFooterActionProps> = ({
  label,
  onClick,
}) => {
  return (
    <div className="shrink-0 overflow-hidden rounded-full border border-border-2 bg-bg-2 shadow-lg">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
      >
        <span>{label}</span>
        <HugeiconsIcon icon={ArrowUpRight} size={10} strokeWidth={2.5} />
      </button>
    </div>
  );
};
