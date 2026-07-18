import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type LlmUsageSpanRecord,
  type ToolUsageAttributionRecord,
  getSessionLlmUsageSpans,
  getSessionToolUsageAttributions,
} from "@src/api/tauri/session/usage";
import type { UsageSessionRow } from "@src/api/tauri/usageDashboard";
import Button from "@src/components/Button";

import { formatTokensShort } from "./usageFormat";

interface UsageSessionDetailProps {
  session: UsageSessionRow;
  onClose: () => void;
  language: string;
}

/** Sum the three token attributions recorded per tool call. */
function toolTokens(tool: ToolUsageAttributionRecord): number {
  return (
    tool.decisionCompletionTokens +
    tool.resultContextTokens +
    tool.followupCompletionTokens
  );
}

/**
 * Per-call breakdown for one session. Reuses the existing native usage-span /
 * tool-attribution commands; those are only populated for ORGII's own agent
 * runs, so imported sessions fall back to a "session-level only" note.
 */
export default function UsageSessionDetail({
  session,
  onClose,
  language,
}: UsageSessionDetailProps) {
  const { t } = useTranslation("sessions", { keyPrefix: "kanban.dataSource" });
  const [spans, setSpans] = useState<LlmUsageSpanRecord[]>([]);
  const [tools, setTools] = useState<ToolUsageAttributionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Request token guards against a stale session's response landing after the
  // user has clicked into a different one. setState lives in this callback (not
  // the effect body) to satisfy react-hooks/set-state-in-effect.
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const [spanRows, toolRows] = await Promise.all([
        getSessionLlmUsageSpans(session.sessionId),
        getSessionToolUsageAttributions(session.sessionId),
      ]);
      if (requestId !== requestRef.current) return;
      setSpans(spanRows);
      setTools(toolRows);
    } catch {
      if (requestId === requestRef.current) {
        setSpans([]);
        setTools([]);
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [session.sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasDetail = spans.length > 0 || tools.length > 0;

  return (
    <div className="rounded-xl border border-border-1 bg-fill-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span
            className="truncate text-[13px] font-semibold text-text-1"
            title={session.name}
          >
            {session.name}
          </span>
          <span className="text-[11px] text-text-3">
            {t("usage.detail.title")}
          </span>
        </div>
        <Button
          iconOnly
          shape="circle"
          size="mini"
          variant="tertiary"
          icon={<X size={14} />}
          onClick={onClose}
          aria-label={t("usage.detail.close")}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-text-3" />
        </div>
      ) : !hasDetail ? (
        <p className="text-[12px] text-text-3">{t("usage.detail.noData")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {spans.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[12px] font-semibold text-text-2">
                {t("usage.detail.perTurn")} ({spans.length})
              </h4>
              {spans.map((span) => (
                <div
                  key={span.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-selected px-3 py-2 text-[12px]"
                >
                  <span
                    className="min-w-0 truncate text-text-2"
                    title={span.model ?? ""}
                  >
                    #{span.iterationIndex} {span.model || "—"}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-3">
                    {t("usage.detail.promptTokens")}{" "}
                    {formatTokensShort(span.promptTokens, language)}
                    {" · "}
                    {t("usage.detail.completionTokens")}{" "}
                    {formatTokensShort(span.completionTokens, language)}
                  </span>
                </div>
              ))}
            </section>
          )}

          {tools.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h4 className="text-[12px] font-semibold text-text-2">
                {t("usage.detail.perTool")} ({tools.length})
              </h4>
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-selected px-3 py-2 text-[12px]"
                >
                  <span
                    className="min-w-0 truncate text-text-1"
                    title={tool.toolName}
                  >
                    {tool.toolName}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-3">
                    {formatTokensShort(toolTokens(tool), language)}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
