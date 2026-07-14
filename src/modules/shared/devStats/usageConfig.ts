import type { CursorSession } from "@src/api/tauri/orgtrackHistory/types";

// ============================================
// Tab config
// ============================================

export const OTHER_USAGE_TABS = [
  { key: "overview", labelKey: "otherUsage.tabs.overview" },
  { key: "cursor", labelKey: "otherUsage.tabs.cursor" },
  { key: "cli", labelKey: "otherUsage.tabs.cli" },
] as const;

export type OtherUsageTabKey = (typeof OTHER_USAGE_TABS)[number]["key"];

export const DEFAULT_TAB: OtherUsageTabKey = "overview";

// ============================================
// Types
// ============================================

export interface ModelStats {
  model: string;
  sessionCount: number;
  tokensUsed: number;
  /** Summed estimated cost (USD) across this model's sessions. */
  estimatedCost: number;
  completedCount: number;
}

export interface OtherUsageViewProps {
  /** Reserved for future per-repo scoping. */
  repoPath?: string | null;
}

// ============================================
// Cost formatting
// ============================================

/**
 * Format a USD cost figure, matching the Sessions-view convention.
 * Per-row figures use 4 decimals (`$0.0123`); summary/aggregate figures use 2.
 */
export function formatCost(value: number, decimals: 2 | 4 = 4): string {
  return `$${value.toFixed(decimals)}`;
}

// ============================================
// Chart metric toggle (cost vs tokens)
// ============================================

export const MODEL_BREAKDOWN_METRIC = {
  COST: "cost",
  TOKENS: "tokens",
} as const;

export type ModelBreakdownMetric =
  (typeof MODEL_BREAKDOWN_METRIC)[keyof typeof MODEL_BREAKDOWN_METRIC];

// ============================================
// Model aggregation
// ============================================

export function buildModelStats(
  sessions: CursorSession[],
  formatModelName: (raw: string) => string
): ModelStats[] {
  const byDisplay = new Map<string, ModelStats>();

  for (const session of sessions) {
    const raw = session.model || "unknown";
    const displayKey = formatModelName(raw);
    const existing = byDisplay.get(displayKey);

    if (existing) {
      existing.sessionCount += 1;
      existing.tokensUsed += session.tokensUsed;
      existing.estimatedCost += session.estimatedCost;
      if (session.status === "completed") existing.completedCount += 1;
    } else {
      byDisplay.set(displayKey, {
        model: raw,
        sessionCount: 1,
        tokensUsed: session.tokensUsed,
        estimatedCost: session.estimatedCost,
        completedCount: session.status === "completed" ? 1 : 0,
      });
    }
  }

  return Array.from(byDisplay.values()).sort(
    (rowA, rowB) => rowB.tokensUsed - rowA.tokensUsed
  );
}
