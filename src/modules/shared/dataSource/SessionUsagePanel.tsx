import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  USAGE_BUCKETS,
  type UsageBucket,
  type UsageRoundRow,
  type UsageScope,
  type UsageSessionSort,
  type UsageSummary,
  type UsageTrendPoint,
  usageDashboardOverview,
} from "@src/api/tauri/usageDashboard";
import Button from "@src/components/Button";
import Select from "@src/components/Select";
import TabPill, { type TabPillItem } from "@src/components/TabPill";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import UsageRoundsTable from "./UsageRoundsTable";
import UsageStatCards from "./UsageStatCards";
import UsageTrendChart from "./UsageTrendChart";
import { BucketIcon, bucketLabelKey } from "./usageBuckets";
import {
  USAGE_RANGE_PRESETS,
  type UsageRangePreset,
  resolveUsageRange,
} from "./usageRange";

const SOURCE_ALL = "all";
const ROUND_ROW_LIMIT = 500;

interface SelectedSession {
  id: string;
  name: string;
}

/** Chat pane → Runtime → Usage: the usage/cost dashboard (per-round request log). */
export default function SessionUsagePanel() {
  const { t, i18n } = useTranslation("sessions", {
    keyPrefix: "kanban.dataSource",
  });
  const language = i18n.resolvedLanguage || i18n.language || "en";

  const [bucket, setBucket] = useState<UsageBucket | null>(null);
  const [range, setRange] = useState<UsageRangePreset>("today");
  const [sort, setSort] = useState<UsageSessionSort>("recent");
  const [refreshTick, setRefreshTick] = useState(0);
  const [session, setSession] = useState<SelectedSession | null>(null);

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [trends, setTrends] = useState<UsageTrendPoint[]>([]);
  const [rows, setRows] = useState<UsageRoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scope = useMemo<UsageScope>(() => {
    const { startMs, endMs } = resolveUsageRange(range);
    return { bucket, startMs, endMs, sessionId: session?.id ?? null };
  }, [bucket, range, session]);

  const hourly = range === "today" || range === "24h";

  // Monotonic request token so a slow response from a stale scope/sort can't
  // overwrite a newer one. setState lives in this callback (not the effect
  // body) to satisfy react-hooks/set-state-in-effect.
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      // One backend call → one round-store scan (summary + trends + log).
      const overview = await usageDashboardOverview(scope, {
        sort,
        limit: ROUND_ROW_LIMIT,
      });
      if (requestId !== requestRef.current) return;
      setSummary(overview.summary);
      setTrends(overview.trends);
      setRows(overview.rounds);
    } catch (err) {
      if (requestId === requestRef.current) setError(String(err));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [scope, sort]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const sourceTabs = useMemo<TabPillItem[]>(
    () => [
      { key: SOURCE_ALL, label: t("usage.allSources") },
      ...USAGE_BUCKETS.map((source) => ({
        key: source,
        label: t(bucketLabelKey(source)),
        icon: <BucketIcon bucket={source} size={14} />,
      })),
    ],
    [t]
  );

  const rangeOptions = useMemo(
    () =>
      USAGE_RANGE_PRESETS.map((preset) => ({
        value: preset,
        label: t(`usage.range.${preset}`),
      })),
    [t]
  );

  const isEmpty = !loading && !error && (summary?.sessionCount ?? 0) === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabPill
          activeTab={bucket ?? SOURCE_ALL}
          tabs={sourceTabs}
          onChange={(key) =>
            setBucket(key === SOURCE_ALL ? null : (key as UsageBucket))
          }
          variant="simple"
          size="default"
          fillWidth={false}
        />
        <div className="flex items-center gap-2">
          <Select
            value={range}
            onChange={(value) => setRange(value as UsageRangePreset)}
            options={rangeOptions}
            size="small"
          />
          <Button
            variant="secondary"
            appearance="outline"
            size="small"
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={() => setRefreshTick((tick) => tick + 1)}
          >
            {t("usage.refresh")}
          </Button>
        </div>
      </div>

      {session && (
        <button
          type="button"
          onClick={() => setSession(null)}
          className="flex w-fit items-center gap-1.5 rounded-full border border-border-1 bg-fill-2 px-2.5 py-1 text-[12px] text-text-2 hover:text-text-1"
        >
          <span className="text-text-3">{t("usage.roundsTable.session")}:</span>
          <span className="max-w-[260px] truncate">{session.name}</span>
          <X size={12} />
        </button>
      )}

      {error ? (
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={t("usage.loadError")}
          subtitle={error}
        />
      ) : isEmpty ? (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("usage.empty.title")}
          subtitle={t("usage.empty.subtitle")}
        />
      ) : loading && !summary ? (
        <Placeholder variant="loading" placement="detail-panel" />
      ) : summary ? (
        <>
          <UsageStatCards summary={summary} language={language} />
          <UsageTrendChart
            points={trends}
            hourly={hourly}
            language={language}
          />
          <UsageRoundsTable
            rows={rows}
            total={rows.length}
            sort={sort}
            onSortChange={setSort}
            onSelectSession={(sessionId) => {
              const row = rows.find((item) => item.sessionId === sessionId);
              setSession({
                id: sessionId,
                name: row?.sessionName ?? sessionId,
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
