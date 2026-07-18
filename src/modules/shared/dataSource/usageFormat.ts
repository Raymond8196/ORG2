/**
 * Formatting + time-range helpers for the Usage dashboard.
 *
 * Token counts here reach hundreds of millions / billions, so the repo's
 * `formatCompactStatNumber` (caps at M) isn't enough — this mirrors the
 * reference dashboard's locale-aware compaction (K/M/B, or 万/亿 for zh/ja).
 */

function normalizeLang(language: string): string {
  return language.toLowerCase().replace(/_/g, "-");
}

/** Compact token count: `1.2M`, `540M`, `5.4亿`… scaled to the UI language. */
export function formatTokensShort(value: number, language: string): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const lang = normalizeLang(language);
  if (lang.startsWith("zh") || lang.startsWith("ja")) {
    if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
    if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
    return value.toLocaleString();
  }
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString();
}

/** USD with a fixed number of decimals. Non-finite → `$0`. */
export function formatUsd(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "$0";
  return `$${value.toFixed(digits)}`;
}

/** Ratio in 0–1 rendered as a whole-number percent. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(1)}%`;
}

/** Full-precision integer with thousands separators. */
export function formatInt(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(locale).format(Math.trunc(value));
}
