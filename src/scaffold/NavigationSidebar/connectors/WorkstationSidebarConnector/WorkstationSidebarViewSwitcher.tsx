import { Hash, History, ListTodo, type LucideIcon } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Tooltip from "@src/components/Tooltip";

export type WorkstationSidebarViewKey = "channels" | "work-items" | "sessions";

interface WorkstationSidebarViewSwitcherProps {
  activeKey: WorkstationSidebarViewKey;
  onChange: (key: WorkstationSidebarViewKey) => void;
}

interface ViewItem {
  key: WorkstationSidebarViewKey;
  label: string;
  icon: LucideIcon;
}

const SWITCHER_ICON_SIZE = 17;
const SELECTED_VIEW_STYLE: React.CSSProperties = {
  boxShadow: "var(--sidebar-tab-pill-selected-shadow)",
};

/** Icon-only primary view switcher rendered below the organization selector. */
export const WorkstationSidebarViewSwitcher: React.FC<WorkstationSidebarViewSwitcherProps> =
  React.memo(({ activeKey, onChange }) => {
    const { t } = useTranslation("navigation");
    const items: ViewItem[] = [
      {
        key: "work-items",
        label: t("labels.workItems"),
        icon: ListTodo,
      },
      {
        key: "sessions",
        label: t("routes.sessions"),
        icon: History,
      },
      {
        key: "channels",
        label: t("routes.channels"),
        icon: Hash,
      },
    ];

    return (
      <nav
        className="shrink-0 px-3 pb-1 pt-1"
        aria-label={t("sidebar.tabs.workstation")}
        data-workstation-sidebar-view-switcher
      >
        <div className="flex items-center gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            const selected = item.key === activeKey;
            return (
              <Tooltip
                key={item.key}
                content={item.label}
                position="bottom"
                mouseEnterDelay={1500}
                showArrow={false}
              >
                <button
                  type="button"
                  className={`flex h-7 flex-1 items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30 ${
                    selected
                      ? "cursor-default bg-chat-pane/70 text-primary-6"
                      : "text-text-2 hover:bg-sidebar-selected hover:text-text-1"
                  }`}
                  style={selected ? SELECTED_VIEW_STYLE : undefined}
                  aria-label={item.label}
                  aria-current={selected ? "page" : undefined}
                  data-testid={`sidebar-view-${item.key}`}
                  onClick={() => onChange(item.key)}
                >
                  <Icon
                    size={SWITCHER_ICON_SIZE}
                    strokeWidth={selected ? 2 : 1.8}
                    aria-hidden
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    );
  });

WorkstationSidebarViewSwitcher.displayName = "WorkstationSidebarViewSwitcher";
