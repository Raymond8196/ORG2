/**
 * WorkStationStartPage
 *
 * Launchpad shown when the WorkStation tab pool holds only the launcher tab
 * (on app start, and whenever the user closes the last real tab). Lets the
 * user pick what to open — sharing its action list with the unified `+` menu
 * (TabBarPlusMenu) via `useWorkStationLaunchActions` so the two always match.
 *
 * Rendered as a compact quick-action list: label + keyboard hint, no icon.
 */
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
} from "@src/components/KeyboardShortcut";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { EDITOR_TAB_CANVAS_BG_CLASS } from "@src/modules/WorkStation/shared/tokens";

import {
  LAUNCHPAD_ACTION_IDS,
  useWorkStationLaunchActions,
} from "../useWorkStationLaunchActions";

interface StartActionRowProps {
  label: string;
  shortcut?: string;
  onClick: () => void;
}

const StartActionRow = memo<StartActionRowProps>(
  ({ label, shortcut, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${SURFACE_TOKENS.hover} active:bg-fill-3`}
    >
      <span className="text-[14px] font-medium text-text-2">{label}</span>
      {shortcut ? (
        <KeyboardShortcut
          shortcut={shortcut}
          variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
        />
      ) : null}
    </button>
  )
);
StartActionRow.displayName = "StartActionRow";

export const WorkStationStartPage: React.FC = memo(() => {
  const { t } = useTranslation("navigation");
  const actions = useWorkStationLaunchActions();

  const visibleActions = useMemo(
    () => actions.filter((action) => LAUNCHPAD_ACTION_IDS.includes(action.id)),
    [actions]
  );

  return (
    <div
      className={`flex h-full w-full items-center justify-center overflow-auto p-8 ${EDITOR_TAB_CANVAS_BG_CLASS}`}
    >
      <div className="w-full max-w-[420px]">
        <h1 className="mb-1 text-[20px] font-semibold text-text-1">
          {t("routes.launchpad")}
        </h1>
        <p className="mb-5 text-[13px] leading-snug text-text-3">
          {t("workstation.startPage.subtitle")}
        </p>
        <div className="flex flex-col gap-0.5">
          {visibleActions.map((action) => (
            <StartActionRow
              key={action.id}
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
