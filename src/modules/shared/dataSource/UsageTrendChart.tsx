import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { UsageTrendPoint } from "@src/api/tauri/usageDashboard";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_MARGIN,
  CHART_TOOLTIP,
} from "@src/components/Chart";

import { formatTokensShort, formatUsd } from "./usageFormat";

/** Series colors, drawn from the semantic token palette (theme-aware). */
const SERIES = {
  input: "var(--color-primary-6)",
  output: "var(--color-success-6)",
  cacheCreate: "var(--color-warning-6)",
  cacheRead: "var(--color-primary-4)",
  cost: "var(--color-danger-5)",
} as const;

interface UsageTrendChartProps {
  points: UsageTrendPoint[];
  /** Hourly x-axis labels (else daily). */
  hourly: boolean;
  language: string;
}

interface ChartDatum {
  label: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  cost: number;
}

function formatBucketLabel(
  ms: number,
  hourly: boolean,
  locale: string
): string {
  const date = new Date(ms);
  return hourly
    ? date.toLocaleString(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : date.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
}

export default function UsageTrendChart({
  points,
  hourly,
  language,
}: UsageTrendChartProps) {
  const { t } = useTranslation("sessions", { keyPrefix: "kanban.dataSource" });

  const data = useMemo<ChartDatum[]>(
    () =>
      points.map((point) => ({
        label: formatBucketLabel(point.bucketMs, hourly, language),
        input: point.inputTokens,
        output: point.outputTokens,
        cacheCreate: point.cacheWriteTokens,
        cacheRead: point.cacheReadTokens,
        cost: point.costUsd,
      })),
    [points, hourly, language]
  );

  return (
    <div className="rounded-xl border border-border-1 bg-fill-2 p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-text-1">
        {t("usage.trends.title")}
      </h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={CHART_MARGIN}>
            <defs>
              {(["input", "output", "cacheCreate", "cacheRead"] as const).map(
                (key) => (
                  <linearGradient
                    key={key}
                    id={`usageTrend-${key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={SERIES[key]}
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="95%"
                      stopColor={SERIES[key]}
                      stopOpacity={0}
                    />
                  </linearGradient>
                )
              )}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke={CHART_GRID_STROKE}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK}
              dy={8}
            />
            <YAxis
              yAxisId="tokens"
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK}
              tickFormatter={(value) => formatTokensShort(value, language)}
              width={48}
            />
            <YAxis
              yAxisId="cost"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK}
              tickFormatter={(value) => `$${value}`}
              width={44}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP.content}
              labelStyle={CHART_TOOLTIP.label}
              itemStyle={CHART_TOOLTIP.item}
              formatter={(value, _name, item) =>
                item?.dataKey === "cost"
                  ? formatUsd(Number(value), 4)
                  : formatTokensShort(Number(value), language)
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="input"
              name={t("usage.trends.input")}
              stroke={SERIES.input}
              fill="url(#usageTrend-input)"
              strokeWidth={2}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="output"
              name={t("usage.trends.output")}
              stroke={SERIES.output}
              fill="url(#usageTrend-output)"
              strokeWidth={2}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="cacheCreate"
              name={t("usage.trends.cacheCreate")}
              stroke={SERIES.cacheCreate}
              fill="url(#usageTrend-cacheCreate)"
              strokeWidth={2}
            />
            <Area
              yAxisId="tokens"
              type="monotone"
              dataKey="cacheRead"
              name={t("usage.trends.cacheRead")}
              stroke={SERIES.cacheRead}
              fill="url(#usageTrend-cacheRead)"
              strokeWidth={2}
            />
            <Area
              yAxisId="cost"
              type="monotone"
              dataKey="cost"
              name={t("usage.trends.cost")}
              stroke={SERIES.cost}
              fill="none"
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
