/**
 * WorkStationStartPage
 *
 * Launchpad shown when the WorkStation tab pool holds only the launcher tab
 * (on app start, and whenever the user closes the last real tab). Lets the
 * user pick what to open — sharing its action list with the unified `+` menu
 * (TabBarPlusMenu) via `useWorkStationLaunchActions` so the two always match.
 */
import { type LucideIcon } from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import KeyBadge from "@src/components/KeyBadge";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { EDITOR_TAB_CANVAS_BG_CLASS } from "@src/modules/WorkStation/shared/tokens";

import { useWorkStationLaunchActions } from "../useWorkStationLaunchActions";

interface StartActionTileProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
}

const StartActionTile = memo<StartActionTileProps>(
  ({ icon: Icon, label, shortcut, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-start gap-3 rounded-xl border border-border-1 bg-fill-1 p-4 text-left transition-colors ${SURFACE_TOKENS.hover} active:bg-fill-3`}
    >
      <Icon size={22} strokeWidth={1.5} className="text-text-3" />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-text-2">{label}</span>
        {shortcut ? <KeyBadge keys={shortcut} showSeparator={false} /> : null}
      </div>
    </button>
  )
);
StartActionTile.displayName = "StartActionTile";

export const WorkStationStartPage: React.FC = memo(() => {
  const { t } = useTranslation("navigation");
  const actions = useWorkStationLaunchActions();

  return (
    <div
      className={`flex h-full w-full items-center justify-center overflow-auto p-8 ${EDITOR_TAB_CANVAS_BG_CLASS}`}
    >
      <div className="w-full max-w-[560px]">
        <h1 className="mb-1 text-[20px] font-semibold text-text-1">
          {t("routes.launchpad")}
        </h1>
        <p className="mb-6 text-[13px] leading-snug text-text-3">
          {t("workstation.startPage.subtitle")}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {actions.map((action) => (
            <StartActionTile
              key={action.id}
              icon={action.icon}
              label={action.label}
              shortcut={action.shortcut}
              onClick={action.onClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

WorkStationStartPage.displayName = "WorkStationStartPage";

export default WorkStationStartPage;
