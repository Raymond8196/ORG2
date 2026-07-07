import { ChevronLeft, ChevronRight } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import ModelIcon from "@src/components/ModelIcon";
import {
  getQuotaBgColorClass,
  getQuotaTextColorClass,
} from "@src/components/QuotaBar";
import { useKeyVault } from "@src/hooks/keyVault";
import {
  type AccountQuotaCard,
  collectAccountQuotaCards,
  formatQuotaResetHint,
} from "@src/hooks/keyVault/accountQuotaDisplay";

export const START_PAGE_TREND_SURFACE_CLASS =
  "rounded-lg border border-border-1 bg-chat-container/70";

export const START_PAGE_HEATMAP_CONTAINER_CLASS = `${START_PAGE_TREND_SURFACE_CLASS} px-3 pt-3 pb-1`;

function StartPageQuotaNavButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StartPageQuotaCard({
  entry,
}: {
  entry: AccountQuotaCard;
}): React.ReactNode {
  const { t: tIntegrations } = useTranslation("integrations");

  return (
    <div className={`min-w-0 p-2 ${START_PAGE_TREND_SURFACE_CLASS}`}>
      <div className="mb-1 flex min-w-0 items-center gap-1.5">
        <ModelIcon agentType={entry.modelType} size="small" />
        <div
          className="min-w-0 flex-1"
          title={
            entry.accountPlan
              ? `${entry.accountName} · ${entry.accountPlan}`
              : entry.accountName
          }
        >
          <div className="truncate text-[11px] font-semibold leading-4 text-text-1">
            {entry.accountName}
          </div>
          {entry.accountPlan ? (
            <div className="truncate text-[10px] leading-3 text-text-3">
              {entry.accountPlan}
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        {entry.metrics.map((metric) => {
          const textColorClass = getQuotaTextColorClass(
            metric.remainingPercent
          );
          const barBgClass = getQuotaBgColorClass(metric.remainingPercent);
          const resetHint = formatQuotaResetHint(
            metric.key,
            metric.remainingPercent,
            metric.resetTime,
            tIntegrations
          );
          return (
            <div key={metric.key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="min-w-0 truncate text-text-3">
                  {metric.label}
                  {resetHint ? (
                    <span title={resetHint.full}> ({resetHint.compact})</span>
                  ) : null}
                </span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${textColorClass}`}
                >
                  {tIntegrations("keyVault.quota.percentLeft", {
                    percent: Math.round(metric.remainingPercent),
                  })}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-fill-3">
                <div
                  className={`h-full rounded-full transition-all ${barBgClass}`}
                  style={{ width: `${metric.remainingPercent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StartPageQuotaGridProps {
  isWide: boolean;
  className?: string;
}

export function StartPageQuotaGrid({
  isWide,
  className,
}: StartPageQuotaGridProps): React.ReactNode {
  const { t } = useTranslation("sessions");
  const { t: tIntegrations } = useTranslation("integrations");
  const { accounts } = useKeyVault({ autoLoad: true });
  const [pageIndex, setPageIndex] = useState(0);

  const pageSize = isWide ? 4 : 3;
  const gridClassName = isWide ? "grid-cols-2" : "grid-cols-3";

  const entries = useMemo(
    () => collectAccountQuotaCards(accounts, t, tIntegrations),
    [accounts, t, tIntegrations]
  );

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePageIndex = pageIndex % pageCount;

  const visibleEntries = useMemo(() => {
    const start = safePageIndex * pageSize;
    return entries.slice(start, start + pageSize);
  }, [entries, pageSize, safePageIndex]);

  const switchPage = useCallback(
    (direction: "previous" | "next") => {
      setPageIndex((currentIndex) => {
        const delta = direction === "previous" ? -1 : 1;
        return (currentIndex + delta + pageCount) % pageCount;
      });
    },
    [pageCount]
  );

  if (entries.length === 0) {
    return (
      <p
        className={`px-1 text-center text-[13px] text-text-3 ${className ?? ""}`}
      >
        {t("chat.startPage.quota.empty")}
      </p>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className={`grid gap-2 ${gridClassName}`}>
        {visibleEntries.map((entry) => (
          <StartPageQuotaCard key={entry.id} entry={entry} />
        ))}
      </div>
      {entries.length > pageSize ? (
        <div className="group flex items-center justify-center gap-1 px-1 text-center text-[13px] leading-6 text-text-3">
          <StartPageQuotaNavButton
            label={t("chat.startPage.hints.previous")}
            onClick={() => switchPage("previous")}
          >
            <ChevronLeft size={14} strokeWidth={1.8} />
          </StartPageQuotaNavButton>
          <p className="min-w-0 flex-1 truncate tabular-nums">
            {safePageIndex + 1} / {pageCount}
          </p>
          <StartPageQuotaNavButton
            label={t("chat.startPage.hints.next")}
            onClick={() => switchPage("next")}
          >
            <ChevronRight size={14} strokeWidth={1.8} />
          </StartPageQuotaNavButton>
        </div>
      ) : null}
    </div>
  );
}
