/**
 * devStats — shared developer-usage statistics logic.
 *
 * Relocated from the retired Dev Record page. These exports carry the
 * usage/cost stats layer (pricing-aware model aggregation, date-range helpers,
 * session auto-refresh) plus the reusable presentational atoms so the chat-pane
 * usage overview + trends can consume them without a rendered Dev Record view.
 */

// Presentational atoms
export { default as HeatmapGrid } from "./HeatmapGrid";
export type {
  HeatmapGridCell,
  HeatmapGridCellSession,
  HeatmapGridLabel,
  HeatmapGridProps,
} from "./HeatmapGrid";
export { default as StatCard, DiffValue } from "./StatCard";
export type { StatCardProps, StatCardDelta } from "./StatCard";
export { default as DateRangePill } from "./DateRangePill";
export type { DateRangePillOption } from "./DateRangePill";
export { default as DateRangePills } from "./DateRangePills";
export { default as EstimatedTag, EstimatedCostHeader } from "./EstimatedTag";
export { STAT_CARD_CONFIG } from "./statCardConfig";
export type { StatCardConfig, StatCardKey } from "./statCardConfig";

// Usage-stats data layer
export { useOtherUsageData } from "./useOtherUsageData";
export type { UseOtherUsageDataReturn } from "./useOtherUsageData";
export {
  buildModelStats,
  formatCost,
  MODEL_BREAKDOWN_METRIC,
  OTHER_USAGE_TABS,
  DEFAULT_TAB,
} from "./usageConfig";
export type {
  ModelStats,
  ModelBreakdownMetric,
  OtherUsageTabKey,
  OtherUsageViewProps,
} from "./usageConfig";

// Date-range + model-name helpers
export {
  DATE_RANGE_OPTIONS,
  DEFAULT_RANGE,
  computeDateRange,
  computePreviousDateRange,
  computeDeltaPercent,
  formatModelName,
  formatModelNameFull,
  formatTokenCount,
  formatDuration,
  getHeatmapColor,
} from "./config";
export type { ProfileDateRange, DateRangeResult } from "./config";

// Session auto-refresh (stale-while-revalidate) hook
export { useSessionAutoRefresh } from "./useSessionAutoRefresh";
