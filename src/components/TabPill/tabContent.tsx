import type { ReactNode } from "react";

import type { TabPillItem } from "./types";

/**
 * Renders a label whose box is always the width of its BOLD form, so toggling
 * active (400↔600) never reflows neighbours — the whole point of "no shake on
 * reselect".
 *
 * A grid stacks both copies in the same cell: the invisible bold ghost fixes
 * the cell size, the visible copy sits in the identical cell start-aligned, so
 * its left edge is pinned and it only grows rightward within the reserved box
 * (no re-centering jitter that an absolute overlay would introduce).
 */
export function BoldStableLabel({
  label,
  isBold,
}: {
  label: string;
  isBold: boolean;
}) {
  return (
    <span className="grid items-center justify-items-start">
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 whitespace-nowrap font-semibold"
      >
        {label}
      </span>
      <span
        className="col-start-1 row-start-1 min-w-0 truncate"
        style={{ fontWeight: isBold ? 600 : 400 }}
      >
        {label}
      </span>
    </span>
  );
}

export function renderTabContent(
  tab: TabPillItem,
  isIconOnly: boolean,
  reserveBoldWidth: boolean,
  isActive: boolean,
  isHovered?: boolean,
  boldWhenActive = true
): ReactNode {
  const displayIcon = isHovered && tab.hoverIcon ? tab.hoverIcon : tab.icon;
  if (isIconOnly || (tab.icon && !tab.label)) {
    return displayIcon || <span className="truncate">{tab.label}</span>;
  }
  const label = reserveBoldWidth ? (
    <BoldStableLabel label={tab.label} isBold={isActive && boldWhenActive} />
  ) : (
    <span className="truncate">{tab.label}</span>
  );
  if (tab.icon || tab.badge || tab.hoverIcon) {
    return (
      <div className="flex items-center gap-1.5">
        {displayIcon && (
          <div className="flex flex-shrink-0 items-center">{displayIcon}</div>
        )}
        {label}
        {tab.badge && (
          <div className="flex flex-shrink-0 items-center">{tab.badge}</div>
        )}
      </div>
    );
  }
  return label;
}
