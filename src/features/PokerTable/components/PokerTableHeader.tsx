/**
 * Draggable window header for the table, in the shared floating-window
 * chrome (`HEADER_CLASSES.pageHeader` + `useWindowDrag`, like
 * `DetailPanelHeader`) but with the table's own left slot — a stakes
 * dropdown as the title — and right slot: hand number, history, settings,
 * "Leave table", close.
 */
import { ChevronDown, History, SlidersHorizontal, X } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useWindowDrag } from "@src/components/FloatingWindow/useWindowDrag";
import {
  HEADER_BUTTON,
  HEADER_CLASSES,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import {
  POKER_STAKES_OPTIONS,
  type PokerStakesId,
  type StoredPokerSettings,
} from "@src/store/ui/pokerTableAtom";

import type { Blinds } from "../engine/types";
import { formatStakes } from "../format";

export interface PokerTableHeaderProps {
  blinds: Blinds;
  handNumber: number;
  settings: StoredPokerSettings;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onChangeStakes: (stakesId: PokerStakesId) => void;
  onChangeSpeed: (speed: StoredPokerSettings["speed"]) => void;
  onLeave: () => void;
  onClose: () => void;
}

const PokerTableHeader: React.FC<PokerTableHeaderProps> = ({
  blinds,
  handNumber,
  settings,
  historyOpen,
  onToggleHistory,
  onChangeStakes,
  onChangeSpeed,
  onLeave,
  onClose,
}) => {
  const { t } = useTranslation("sessions");
  const onPointerDown = useWindowDrag(true);
  const stakesLabel = formatStakes(blinds.smallBlind, blinds.bigBlind);

  return (
    <div
      className={`${HEADER_CLASSES.pageHeader} cursor-grab select-none !border-b-0`}
      onPointerDown={onPointerDown}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <Dropdown
          trigger="click"
          position="bottom-start"
          getPopupContainer={() => document.body}
          avoidViewportOverflow
          options={POKER_STAKES_OPTIONS.map((option) => ({
            value: option.id,
            label: t("pokerTable.header.title", {
              stakes: formatStakes(option.smallBlind, option.bigBlind),
            }),
          }))}
          value={settings.stakesId}
          onSelect={(value) => onChangeStakes(String(value) as PokerStakesId)}
        >
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded px-1 text-[13px] font-medium text-text-1 hover:bg-fill-1"
            data-no-window-drag
            title={t("pokerTable.settings.stakes")}
          >
            <span className="truncate">
              {t("pokerTable.header.title", { stakes: stakesLabel })}
            </span>
            <ChevronDown
              size={HEADER_ICON_SIZE.sm}
              className="shrink-0 text-text-3"
            />
          </button>
        </Dropdown>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        {handNumber > 0 && (
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {t("pokerTable.header.hand", { number: handNumber })}
          </span>
        )}
        <button
          type="button"
          className={`${HEADER_BUTTON.action} ${historyOpen ? "bg-fill-2 text-text-1" : ""}`}
          onClick={onToggleHistory}
          title={t("pokerTable.header.history")}
        >
          <History size={HEADER_ICON_SIZE.sm} />
        </button>
        <Dropdown
          trigger="click"
          position="bottom-end"
          getPopupContainer={() => document.body}
          avoidViewportOverflow
          droplist={
            <div
              className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.menuClass} p-1`}
            >
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-3">
                {t("pokerTable.settings.speed")}
              </div>
              {(["normal", "fast"] as const).map((speed) => (
                <button
                  key={speed}
                  type="button"
                  role="menuitemradio"
                  aria-checked={settings.speed === speed}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-[12px] hover:bg-fill-1 ${
                    settings.speed === speed ? "text-text-1" : "text-text-2"
                  }`}
                  onClick={() => onChangeSpeed(speed)}
                >
                  <span>{t(`pokerTable.settings.speed_${speed}`)}</span>
                  {settings.speed === speed && (
                    <span className="text-primary-6">•</span>
                  )}
                </button>
              ))}
            </div>
          }
        >
          <button
            type="button"
            className={HEADER_BUTTON.action}
            title={t("pokerTable.header.settings")}
            data-no-window-drag
          >
            <SlidersHorizontal size={HEADER_ICON_SIZE.sm} />
          </button>
        </Dropdown>
        <Button
          variant="secondary"
          appearance="outline"
          size="mini"
          shape="round"
          onClick={onLeave}
        >
          {t("pokerTable.header.leave")}
        </Button>
        <span aria-hidden className="h-4 w-px flex-shrink-0 bg-border-2" />
        <button
          type="button"
          className={HEADER_BUTTON.action}
          onClick={onClose}
          title={t("pokerTable.header.close")}
        >
          <X size={HEADER_ICON_SIZE.sm} />
        </button>
      </div>
    </div>
  );
};

export default PokerTableHeader;
