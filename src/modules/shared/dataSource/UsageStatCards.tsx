import { useTranslation } from "react-i18next";

import type { UsageSummary } from "@src/api/tauri/usageDashboard";
import { STAT_GRID_TOKENS } from "@src/modules/shared/layouts/blocks";

import {
  formatInt,
  formatPercent,
  formatTokensShort,
  formatUsd,
} from "./usageFormat";

interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}

/** One KPI tile — mirrors the AIImpactContent StatItem card surface. */
function StatTile({ label, value, sub, emphasis }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border-1 bg-fill-2 p-4">
      <span className="text-[12px] text-text-2">{label}</span>
      <span
        className={
          emphasis
            ? "text-2xl font-semibold text-text-1"
            : "text-lg font-semibold text-text-1"
        }
      >
        {value}
      </span>
      {sub ? <span className="text-[11px] text-text-3">{sub}</span> : null}
    </div>
  );
}

interface UsageStatCardsProps {
  summary: UsageSummary;
  /** Resolved UI language, for locale-aware token compaction. */
  language: string;
}

/**
 * Headline KPI grid: real total tokens, estimated cost, sessions, cache-hit
 * rate, plus the input/output/cache token split — mirroring the reference
 * dashboard's hero row.
 */
export default function UsageStatCards({
  summary,
  language,
}: UsageStatCardsProps) {
  const { t } = useTranslation("sessions", { keyPrefix: "kanban.dataSource" });
  const tokens = (value: number) => formatTokensShort(value, language);

  return (
    // @container so STAT_GRID_TOKENS.cols4's `@[600px]:grid-cols-4` resolves
    // against the panel width — collapses the 8 tiles to two rows of four.
    <div className="flex flex-col gap-3 @container">
      <div className={STAT_GRID_TOKENS.cols4}>
        <StatTile
          label={t("usage.cards.realTokens")}
          value={tokens(summary.realTotalTokens)}
          sub={formatInt(summary.realTotalTokens, language)}
          emphasis
        />
        <StatTile
          label={t("usage.cards.cost")}
          value={formatUsd(summary.costUsd, 2)}
          sub={formatUsd(summary.costUsd, 4)}
          emphasis
        />
        <StatTile
          label={t("usage.cards.sessions")}
          value={formatInt(summary.sessionCount, language)}
          sub={
            t("usage.cards.requests") +
            ": " +
            formatInt(summary.requestCount, language)
          }
          emphasis
        />
        <StatTile
          label={t("usage.cards.cacheHit")}
          value={formatPercent(summary.cacheHitRate)}
          emphasis
        />
      </div>
      <div className={STAT_GRID_TOKENS.cols4}>
        <StatTile
          label={t("usage.cards.input")}
          value={tokens(summary.inputTokens)}
        />
        <StatTile
          label={t("usage.cards.output")}
          value={tokens(summary.outputTokens)}
        />
        <StatTile
          label={t("usage.cards.cacheCreate")}
          value={tokens(summary.cacheWriteTokens)}
        />
        <StatTile
          label={t("usage.cards.cacheRead")}
          value={tokens(summary.cacheReadTokens)}
        />
      </div>
    </div>
  );
}
