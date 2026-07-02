import { useAtomValue } from "jotai";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import React, { memo, useEffect, useMemo, useReducer, useRef } from "react";

import { sessionStepExplain } from "@src/api/services/keyValidation";
import {
  currentEventAtom,
  currentSimulatorEventIndexAtom,
  simulatorEventCountAtom,
} from "@src/engines/SessionCore";
import type { SessionEvent } from "@src/engines/SessionCore";

type ExplanationStatus = "idle" | "loading" | "ready" | "fallback";

interface ExplanationState {
  status: ExplanationStatus;
  text: string;
  cacheKey?: string;
}

const STEP_EXPLANATION_CACHE_LIMIT = 200;
const STEP_EXPLANATION_CACHE = new Map<string, string>();

function rememberExplanation(cacheKey: string, explanation: string): void {
  if (STEP_EXPLANATION_CACHE.has(cacheKey)) {
    STEP_EXPLANATION_CACHE.delete(cacheKey);
  }
  STEP_EXPLANATION_CACHE.set(cacheKey, explanation);
  if (STEP_EXPLANATION_CACHE.size > STEP_EXPLANATION_CACHE_LIMIT) {
    const firstKey = STEP_EXPLANATION_CACHE.keys().next().value;
    if (firstKey) STEP_EXPLANATION_CACHE.delete(firstKey);
  }
}

function compactText(value: unknown, maxLength = 140): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function buildLocalExplanation(
  event: SessionEvent | null,
  currentIndex: number,
  eventCount: number
): string {
  if (!event || eventCount === 0) {
    return "等待 session 步骤产生后，MiniCPM 会在这里解释当前操作。";
  }

  const ordinal =
    currentIndex >= 0 && eventCount > 0
      ? `第 ${currentIndex + 1}/${eventCount} 步`
      : "当前步骤";
  const displayText = compactText(event.displayText);
  const filePath = compactText(event.filePath, 90);
  const command = compactText(event.command, 100);

  if (command) {
    return `${ordinal}正在执行命令 ${command}，用于推进当前任务或验证已有改动。`;
  }

  if (filePath) {
    return `${ordinal}正在处理文件 ${filePath}，用于读取、修改或验证当前任务相关代码。`;
  }

  if (displayText) {
    return `${ordinal}发生了 ${displayText}，这是当前 session 推进过程中的一个操作节点。`;
  }

  if (event.functionName) {
    return `${ordinal}调用了 ${event.functionName}，用于完成当前任务中的一个工具操作。`;
  }

  return `${ordinal}记录了一个 session 事件，当前可用信息有限。`;
}

function buildCacheKey(event: SessionEvent | null): string | null {
  if (!event) return null;
  return `${event.id}:${event.displayStatus}`;
}

function toStepExplainRequest(event: SessionEvent) {
  return {
    eventId: event.id,
    functionName: event.functionName,
    actionType: event.actionType,
    displayText: event.displayText,
    displayStatus: event.displayStatus,
    displayVariant: event.displayVariant,
    source: event.source,
    filePath: event.filePath ?? null,
    command: event.command ?? null,
    args: event.args,
    result: event.result,
  };
}

function useMiniCPMStepExplanation(): ExplanationState & {
  currentIndex: number;
  eventCount: number;
} {
  const event = useAtomValue(currentEventAtom);
  const currentIndex = useAtomValue(currentSimulatorEventIndexAtom);
  const eventCount = useAtomValue(simulatorEventCountAtom);
  const cacheKey = useMemo(() => buildCacheKey(event), [event]);
  const localExplanation = useMemo(
    () => buildLocalExplanation(event, currentIndex, eventCount),
    [currentIndex, event, eventCount]
  );
  const requestSeqRef = useRef(0);
  const [state, dispatchState] = useReducer(
    (_prev: ExplanationState, next: ExplanationState) => next,
    {
      status: "idle",
      text: localExplanation,
      cacheKey: cacheKey ?? undefined,
    }
  );

  useEffect(() => {
    if (!event || !cacheKey) {
      dispatchState({
        status: "idle",
        text: localExplanation,
        cacheKey: undefined,
      });
      return;
    }

    const cached = STEP_EXPLANATION_CACHE.get(cacheKey);
    if (cached) {
      dispatchState({ status: "ready", text: cached, cacheKey });
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    dispatchState({ status: "loading", text: localExplanation, cacheKey });

    const timer = window.setTimeout(() => {
      void sessionStepExplain(toStepExplainRequest(event))
        .then((response) => {
          if (requestSeqRef.current !== requestSeq) return;
          const explanation = response.explanation.trim();
          if (!explanation) {
            dispatchState({
              status: "fallback",
              text: localExplanation,
              cacheKey,
            });
            return;
          }
          rememberExplanation(cacheKey, explanation);
          dispatchState({ status: "ready", text: explanation, cacheKey });
        })
        .catch(() => {
          if (requestSeqRef.current !== requestSeq) return;
          dispatchState({
            status: "fallback",
            text: localExplanation,
            cacheKey,
          });
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [cacheKey, event, localExplanation]);

  return { ...state, currentIndex, eventCount };
}

const MiniCPMStepExplanationPanel: React.FC = memo(() => {
  const { status, text, currentIndex, eventCount } =
    useMiniCPMStepExplanation();
  const hasStep = eventCount > 0 && currentIndex >= 0;
  const statusLabel =
    status === "loading"
      ? "MiniCPM 解析中"
      : status === "ready"
        ? "MiniCPM"
        : status === "fallback"
          ? "本地摘要"
          : "等待步骤";
  const icon =
    status === "loading" ? (
      <Loader2 size={14} className="animate-spin text-primary-6" />
    ) : status === "fallback" ? (
      <AlertCircle size={14} className="text-text-4" />
    ) : (
      <Sparkles
        size={14}
        className={hasStep ? "text-primary-6" : "text-text-4"}
      />
    );

  return (
    <div className="w-full border-t border-border-2 bg-fill-1/95 px-3 py-2">
      <div className="flex h-14 min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-2 bg-fill-2">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[11px] leading-none text-text-4">
            <span className="font-medium text-text-3">{statusLabel}</span>
            {hasStep ? (
              <span>
                {currentIndex + 1} / {eventCount}
              </span>
            ) : null}
          </div>
          <div className="line-clamp-2 text-xs leading-5 text-text-2">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
});

MiniCPMStepExplanationPanel.displayName = "MiniCPMStepExplanationPanel";

export default MiniCPMStepExplanationPanel;
