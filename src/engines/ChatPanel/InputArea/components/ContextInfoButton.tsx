/**
 * ContextInfoButton
 *
 * Circular progress ring in the chat input toolbar. Click opens a popover
 * showing context fill, a segmented breakdown bar, and per-category rows.
 *
 * Data strategy:
 *   - `contextUsage` arrives from Rust after `agent:complete`.
 *   - Sections come from the final provider request payload only.
 *   - Categories with no live data are hidden, no mock/placeholder values.
 */
import { useSetAtom } from "jotai";
import { Archive, Sparkles, X } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { manualCompactSession } from "@src/api/tauri/agent/session";
import { Message } from "@src/components/Message";
import { triggerSessionReloadAtom } from "@src/engines/SessionCore";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useSetting } from "@src/hooks/settings/useSettings";

import ContextBreakdownBar from "./ContextBreakdownBar";
import ContextCategoryRow from "./ContextCategoryRow";
import ProgressRing from "./ProgressRing";
import { type PanelCategory, ringToneForPercentage } from "./contextInfoTypes";
import { useContextPanel } from "./useContextPanel";
import { formatTokenCount, useContextUsageInfo } from "./useContextUsageInfo";

export interface ContextInfoButtonProps {
  repoPath?: string;
  /**
   * "toolbar" - icon-only button (used in the right toolbar cluster).
   * "corner"  - icon + label pill anchored to the editor's bottom-right.
   */
  variant?: "toolbar" | "corner";
  /**
   * When true, the corner variant omits the text label and shows only the
   * progress ring. Use when horizontal space is tight (inline/compact row).
   */
  compact?: boolean;
}

const ContextInfoButton: React.FC<ContextInfoButtonProps> = memo(
  ({ variant = "toolbar", compact = false }) => {
    const { t } = useTranslation();
    const { sessionId } = useSessionId();
    const triggerSessionReload = useSetAtom(triggerSessionReloadAtom);
    const {
      percentage,
      tokenLabel,
      maxTokens,
      contextUsage,
      cacheReadTokens,
      cacheWriteTokens,
      cacheHitRate,
      cacheSavedTokens,
    } = useContextUsageInfo();

    const { panelPos, triggerRef, panelRef, toggle, close } = useContextPanel();
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [manualCompacting, setManualCompacting] = useState(false);
    const [miniCpmSilentEnabled, setMiniCpmSilentEnabled] = useSetting(
      "housekeeper.features.silentContextCompaction"
    );

    const ringTone = ringToneForPercentage(percentage);
    const displayPct = percentage > 100 ? 100 : percentage;
    const cornerLabelClass =
      ringTone === "unused" ? "text-text-4" : "text-text-2";
    const hasCache = cacheReadTokens > 0 || cacheWriteTokens > 0;
    // Surface the cache savings as the hero line whenever there is a
    // meaningful hit rate. This is ORGII's cost advantage over CC / Codex /
    // Cursor and the thing the user should notice first.
    const showCacheHero = cacheHitRate > 0.05 && cacheSavedTokens > 0;
    // Keep the corner pill calm: only show the running percentage once we are
    // actually approaching the auto-compaction zone.
    const showCornerPercent = percentage >= 90;

    const categories: PanelCategory[] = useMemo(() => {
      const colors: Record<string, string> = {
        stable_prompt: "#9ca3af",
        dynamic_prompt: "#a78bfa",
        rules: "#34d399",
        skills: "#fbbf24",
        memory: "#22c55e",
        conversation: "#fb923c",
        tool_results: "#60a5fa",
        attachments: "#e879f9",
        other: "#94a3b8",
        unattributed: "#f87171",
      };
      return (contextUsage?.sections ?? [])
        .filter((section) => section.estimatedTokens > 0)
        .map((section) => ({
          key: section.category,
          label: section.label,
          tokens: section.estimatedTokens,
          percent: section.percent,
          hex: colors[section.category] ?? colors.other,
        }));
    }, [contextUsage]);

    const handleMouseEnter = useCallback(
      (key: string) => () => setHoveredKey(key),
      []
    );
    const handleMouseLeave = useCallback(() => setHoveredKey(null), []);
    const toggleMiniCpmSilent = useCallback(
      () => setMiniCpmSilentEnabled(!miniCpmSilentEnabled),
      [miniCpmSilentEnabled, setMiniCpmSilentEnabled]
    );
    const runManualCompact = useCallback(async () => {
      if (manualCompacting) return;
      if (!sessionId) {
        Message.info(t("contextInfo.manualCompactNoRuntime"));
        return;
      }

      setManualCompacting(true);
      try {
        const result = await manualCompactSession(sessionId);

        switch (result.status) {
          case "compacted":
            await eventStoreProxy.evictSession(sessionId);
            triggerSessionReload(sessionId);
            Message.success(
              t("contextInfo.manualCompactSuccess", {
                messagesBefore: result.messagesBefore ?? 0,
                messagesAfter: result.messagesAfter ?? 0,
                tokensBefore: formatTokenCount(result.tokensBefore ?? 0),
                tokensAfter: formatTokenCount(result.tokensAfter ?? 0),
              }),
              { duration: 2600 }
            );
            break;
          case "too_short":
            Message.info(t("contextInfo.manualCompactTooShort"));
            break;
          case "already_compact":
            Message.info(t("contextInfo.manualCompactAlreadyCompact"));
            break;
          case "busy":
            Message.info(t("contextInfo.manualCompactBusy"));
            break;
          case "no_runtime":
            Message.info(t("contextInfo.manualCompactNoRuntime"));
            break;
          case "failed":
          default:
            Message.error(
              t("contextInfo.manualCompactFailed", {
                message: result.message ?? t("common:errors.unknown"),
              }),
              { duration: 3200 }
            );
            break;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "");
        Message.error(
          t("contextInfo.manualCompactFailed", {
            message: message || t("common:errors.unknown"),
          }),
          { duration: 3200 }
        );
      } finally {
        setManualCompacting(false);
      }
    }, [manualCompacting, sessionId, t, triggerSessionReload]);

    return (
      <>
        {variant === "corner" ? (
          <button
            ref={triggerRef}
            data-testid="context-info-button"
            className={`flex h-[28px] shrink-0 items-center gap-1.5 rounded-full text-text-3 transition-colors duration-200 hover:bg-fill-2 ${compact ? "w-[28px] justify-center px-0" : "px-2"}`}
            onClick={toggle}
            aria-label={t("contextInfo.ariaLabel")}
            aria-expanded={panelPos !== null}
          >
            <ProgressRing percentage={displayPct} tone={ringTone} />
            {!compact && showCornerPercent && (
              <span
                className={`text-[12px] tabular-nums leading-none ${cornerLabelClass}`}
              >
                {percentage.toFixed(0)}%
              </span>
            )}
          </button>
        ) : (
          <button
            ref={triggerRef}
            data-testid="context-info-button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors duration-150 hover:bg-fill-2 hover:text-text-2"
            onClick={toggle}
            aria-label={t("contextInfo.ariaLabel")}
            aria-expanded={panelPos !== null}
          >
            <ProgressRing percentage={displayPct} tone={ringTone} />
          </button>
        )}

        {panelPos &&
          createPortal(
            <div
              ref={panelRef}
              data-testid="context-info-panel"
              className="fixed z-[99999] w-[320px] overflow-hidden rounded-xl border border-border-2 bg-bg-2 shadow-2xl"
              style={{ bottom: panelPos.bottom, right: panelPos.right }}
            >
              <div className="px-4 pb-3 pt-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-text-1">
                    {t("contextInfo.title")}
                  </span>
                  <button
                    type="button"
                    onClick={close}
                    className="flex h-5 w-5 items-center justify-center rounded text-text-3 transition-colors hover:bg-fill-2 hover:text-text-2"
                    aria-label={t("common:actions.close")}
                  >
                    <X size={12} />
                  </button>
                </div>

                <p className="mt-0.5 text-[13px] text-text-3">{tokenLabel}</p>

                {showCacheHero ? (
                  <div className="mt-2 rounded-lg bg-green-500/10 px-2.5 py-1.5">
                    <p className="text-[12px] font-semibold text-green-600">
                      {t("contextInfo.cacheHero", {
                        pct: Math.round(cacheHitRate * 100),
                        tokens: formatTokenCount(cacheSavedTokens),
                      })}
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-text-3">
                      {t("contextInfo.cacheHeroSub")}
                    </p>
                  </div>
                ) : (
                  hasCache && (
                    <p className="mt-0.5 text-[11px] text-green-600">
                      {t("contextInfo.cacheSaved", {
                        read: formatTokenCount(cacheReadTokens),
                        write: formatTokenCount(cacheWriteTokens),
                      })}
                    </p>
                  )
                )}

                {ringTone !== "unused" && ringTone !== "normal" && (
                  <p className="mt-1 text-[11px] leading-snug text-text-3">
                    {t("contextInfo.autoCompactNote")}
                  </p>
                )}

                <div className="mt-3">
                  <ContextBreakdownBar
                    categories={categories}
                    maxTokens={maxTokens}
                    hoveredKey={hoveredKey}
                    fallbackPercentage={percentage}
                  />
                </div>
              </div>

              {categories.length > 0 && (
                <div className="px-4 py-2">
                  <div className="flex flex-col">
                    {categories.map((cat) => (
                      <ContextCategoryRow
                        key={cat.key}
                        categoryKey={cat.key}
                        label={cat.label}
                        tokens={cat.tokens}
                        percent={cat.percent}
                        hex={cat.hex}
                        isHovered={hoveredKey === cat.key}
                        onMouseEnter={handleMouseEnter(cat.key)}
                        onMouseLeave={handleMouseLeave}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-border-2 bg-fill-1/30 px-3.5 py-3">
                <div className="overflow-hidden rounded-xl border border-border-2 bg-bg-2 shadow-sm">
                  <button
                    type="button"
                    data-testid="context-info-manual-compact-button"
                    onClick={runManualCompact}
                    aria-busy={manualCompacting}
                    className="group flex h-11 w-full items-center justify-between gap-3 px-3 text-left transition-colors hover:bg-fill-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:bg-fill-2"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-fill-2 text-text-3 transition-colors group-hover:text-text-2">
                        <Archive size={14} />
                      </span>
                      <span className="truncate text-[13px] font-semibold text-text-1">
                        {manualCompacting
                          ? t("contextInfo.manualCompactRunning")
                          : t("contextInfo.manualCompactAction")}
                      </span>
                    </span>
                  </button>

                  <div className="flex h-12 items-center justify-between gap-3 border-t border-border-2 px-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600">
                        <Sparkles size={14} />
                      </div>
                      <span className="truncate text-[13px] font-semibold text-text-1">
                        {t("contextInfo.miniCpmSilentAutoCompact")}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={miniCpmSilentEnabled}
                      aria-label={t("contextInfo.miniCpmSilentToggle")}
                      data-testid="context-info-minicpm-silent-toggle"
                      onClick={toggleMiniCpmSilent}
                      className={
                        miniCpmSilentEnabled
                          ? "relative h-[18px] w-8 shrink-0 rounded-full border border-blue-500/80 bg-blue-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 active:scale-[0.98]"
                          : "relative h-[18px] w-8 shrink-0 rounded-full border border-border-2 bg-fill-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:scale-[0.98]"
                      }
                    >
                      <span
                        className={
                          miniCpmSilentEnabled
                            ? "absolute left-0.5 top-0.5 h-3.5 w-3.5 translate-x-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.22)] transition-transform duration-200 ease-out"
                            : "absolute left-0.5 top-0.5 h-3.5 w-3.5 translate-x-0 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.18)] transition-transform duration-200 ease-out"
                        }
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
);

ContextInfoButton.displayName = "ContextInfoButton";

export default ContextInfoButton;
