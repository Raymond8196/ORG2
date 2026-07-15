import type { TFunction } from "i18next";
import { useAtom } from "jotai";
import {
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Download,
  KeyRound,
} from "lucide-react";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { sessionHeatmap } from "@src/api/tauri/session";
import type { SessionHeatmapResponse } from "@src/api/tauri/session";
import TabPill from "@src/components/TabPill";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { createLogger } from "@src/hooks/logger";
import HeatmapGrid, {
  type HeatmapGridCell,
} from "@src/modules/shared/devStats/HeatmapGrid";
import { useAvailableAppUpdate } from "@src/scaffold/AppUpdater";
import {
  CHAT_PANEL_START_PAGE_TAB,
  chatPanelStartPageTabAtom,
} from "@src/store/ui/chatPanelAtom";

import {
  START_PAGE_HEATMAP_CONTAINER_CLASS,
  START_PAGE_TREND_SURFACE_CLASS,
  StartPageQuotaGrid,
} from "./StartPageQuotaGrid";

const logger = createLogger("ChatPanelStartPage");

const WorkspaceDashboardPanelView = React.lazy(
  () => import("./panels/WorkspaceDashboardPanelView")
);

// The "Runtime" tab reuses the same data-source inventory table shown under
// Kanban → Data source. The panel lives in a shared module so both surfaces
// render the identical component.
const DataSourcePanel = React.lazy(
  () => import("@src/modules/shared/dataSource")
);

type StartPageActionTone = "primary" | "purple" | "success" | "warning";

interface ChatPanelStartPageAction {
  id: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone: StartPageActionTone;
}

const START_PAGE_ACTION_TONE_CLASS: Record<StartPageActionTone, string> = {
  primary:
    "border-primary-6/20 bg-primary-6/5 hover:border-primary-6/30 hover:bg-primary-6/10",
  purple:
    "border-purple-6/20 bg-purple-6/5 hover:border-purple-6/30 hover:bg-purple-6/10",
  success:
    "border-success-6/20 bg-success-6/5 hover:border-success-6/30 hover:bg-success-6/10",
  warning:
    "border-warning-6/20 bg-warning-6/5 hover:border-warning-6/30 hover:bg-warning-6/10",
};

interface StartPageHint {
  id: string;
  textBefore: string;
  command: string;
  textAfter: string;
}

interface ChatPanelStartPageProps {
  className?: string;
  onAddApiKey: () => void;
  onInstallLatestUpdate: () => void;
  onNewWorkItem: () => void;
  sessionLauncher?: React.ReactNode;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

const HEATMAP_DAY_COUNT = 7;
const HEATMAP_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const START_PAGE_HINTS: StartPageHint[] = [
  {
    id: "skill",
    textBefore: "chat.startPage.hints.skill.before",
    command: "/",
    textAfter: "chat.startPage.hints.skill.after",
  },
  {
    id: "ask",
    textBefore: "chat.startPage.hints.ask.before",
    command: "/Ask",
    textAfter: "chat.startPage.hints.ask.after",
  },
  {
    id: "plan",
    textBefore: "chat.startPage.hints.plan.before",
    command: "/Plan",
    textAfter: "chat.startPage.hints.plan.after",
  },
  {
    id: "switch",
    textBefore: "chat.startPage.hints.switch.before",
    command: "< >",
    textAfter: "chat.startPage.hints.switch.after",
  },
];
const HEATMAP_X_LABELS = HEATMAP_HOURS.filter((hour) => hour % 4 === 0).map(
  (hour) => ({ index: hour, label: `${hour}:00` })
);
function formatDateForHeatmap(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getRollingHeatmapRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (HEATMAP_DAY_COUNT - 1));
  return {
    startDate: formatDateForHeatmap(start),
    endDate: formatDateForHeatmap(end),
  };
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

// Temporarily unused: the heatmap is hidden in the Runtime tab for now (its
// call site is commented out). Kept here so it can be re-enabled without
// reconstructing the component.
// eslint-disable-next-line unused-imports/no-unused-vars
function StartPageHeatmap({
  t,
}: {
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}): React.ReactNode {
  const [data, setData] = useState<SessionHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    sessionHeatmap({
      ...getRollingHeatmapRange(),
      metric: "sessions",
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err: unknown) => {
        logger.warn("failed to load session heatmap", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const yLabels = useMemo(() => {
    if (!data) return [];
    const labels = new Map<number, string>();
    for (const cell of data.cells) {
      if (!labels.has(cell.day)) labels.set(cell.day, cell.label);
    }
    return Array.from(labels.entries()).map(([index, label]) => ({
      index,
      label,
    }));
  }, [data]);

  const cells = useMemo<HeatmapGridCell[]>(() => {
    if (!data) return [];
    return data.cells.map((cell) => ({
      xIndex: cell.hour,
      yIndex: cell.day,
      count: cell.count,
      label: `${cell.label} ${cell.hour}:00`,
      sessions: cell.sessions,
    }));
  }, [data]);

  if (loading) {
    return (
      <div className={`${START_PAGE_TREND_SURFACE_CLASS} p-3`}>
        <p className="text-[13px] text-text-2">
          {t("chat.startPage.heatmap.loading")}
        </p>
      </div>
    );
  }

  if (!data || data.totalSessions === 0) {
    return (
      <div className={`${START_PAGE_TREND_SURFACE_CLASS} p-3`}>
        <p className="text-[13px] text-text-2">
          {t("chat.startPage.heatmap.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className={START_PAGE_HEATMAP_CONTAINER_CLASS}>
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-fill-2 px-2 py-2">
          <div className="text-[11px] text-text-2">
            {t("chat.startPage.heatmap.sessions")}
          </div>
          <div className="text-sm font-semibold tabular-nums text-text-1">
            {formatCompactNumber(data.totalSessions)}
          </div>
        </div>
        <div className="rounded-lg bg-fill-2 px-2 py-2">
          <div className="text-[11px] text-text-2">
            {t("chat.startPage.heatmap.tokens")}
          </div>
          <div className="text-sm font-semibold tabular-nums text-text-1">
            {formatCompactNumber(data.totalTokens)}
          </div>
        </div>
        <div className="rounded-lg bg-fill-2 px-2 py-2">
          <div className="text-[11px] text-text-2">
            {t("chat.startPage.heatmap.cost")}
          </div>
          <div className="text-sm font-semibold tabular-nums text-text-1">
            ${data.totalCost.toFixed(2)}
          </div>
        </div>
      </div>
      <HeatmapGrid
        cells={cells}
        xCount={24}
        yCount={HEATMAP_DAY_COUNT}
        xLabels={HEATMAP_X_LABELS}
        yLabels={yLabels}
        maxCount={Math.max(1, data.maxCount)}
        unit="session"
        yLabelWidth={28}
        showLegend={false}
      />
    </div>
  );
}

function StartPageActionCard({
  action,
}: {
  action: ChatPanelStartPageAction;
}): React.ReactNode {
  return (
    <button
      type="button"
      className={`group flex w-full items-center gap-2 rounded-full border px-2 py-1.5 text-left shadow-sm transition-colors focus-visible:border-primary-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/20 ${START_PAGE_ACTION_TONE_CLASS[action.tone]}`}
      onClick={action.onClick}
      data-testid={`chat-panel-start-page-${action.id}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-2 text-text-2 transition-colors group-hover:bg-fill-3">
        {action.icon}
      </span>
      <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
        {action.title}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

function StartPageCommandPill({
  command,
}: {
  command: string;
}): React.ReactNode {
  return (
    <span className="mx-0.5 inline-flex rounded-md bg-fill-2 px-1.5 py-0.5 text-[12px] font-medium leading-none text-text-2">
      {command}
    </span>
  );
}

function StartPageHintNavButton({
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
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-3 opacity-0 transition-colors hover:bg-fill-2 hover:text-text-1 group-focus-within:opacity-100 group-hover:opacity-100"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StartPageHintLine({
  t,
}: {
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}): React.ReactNode {
  const [hintIndex, setHintIndex] = useState(0);
  const hint = START_PAGE_HINTS[hintIndex];
  const switchHint = useCallback((direction: "previous" | "next") => {
    setHintIndex((currentIndex) => {
      const delta = direction === "previous" ? -1 : 1;
      return (
        (currentIndex + delta + START_PAGE_HINTS.length) %
        START_PAGE_HINTS.length
      );
    });
  }, []);

  return (
    <div className="group flex items-center justify-center gap-1 px-1 text-center text-[13px] leading-6 text-text-3">
      <StartPageHintNavButton
        label={t("chat.startPage.hints.previous")}
        onClick={() => switchHint("previous")}
      >
        <ChevronLeft size={14} strokeWidth={1.8} />
      </StartPageHintNavButton>
      <p className="min-w-0 flex-1 truncate">
        <span>{t(hint.textBefore)} </span>
        <StartPageCommandPill command={hint.command} />
        <span> {t(hint.textAfter)}</span>
      </p>
      <StartPageHintNavButton
        label={t("chat.startPage.hints.next")}
        onClick={() => switchHint("next")}
      >
        <ChevronRight size={14} strokeWidth={1.8} />
      </StartPageHintNavButton>
    </div>
  );
}

export function ChatPanelStartPage({
  className,
  onAddApiKey,
  onInstallLatestUpdate,
  onNewWorkItem,
  sessionLauncher,
  t,
}: ChatPanelStartPageProps): React.ReactNode {
  const [activeTab, setActiveTab] = useAtom(chatPanelStartPageTabAtom);
  const availableUpdate = useAvailableAppUpdate();
  const tabs = useMemo(
    () => [
      {
        key: CHAT_PANEL_START_PAGE_TAB.WORK,
        label: t("chat.startPage.tabs.work"),
        dataTestId: "chat-panel-start-page-tab-work",
      },
      {
        key: CHAT_PANEL_START_PAGE_TAB.MANAGE,
        label: t("chat.startPage.tabs.manage"),
        dataTestId: "chat-panel-start-page-tab-manage",
      },
      {
        key: CHAT_PANEL_START_PAGE_TAB.RUNTIME,
        label: t("chat.startPage.tabs.runtime"),
        dataTestId: "chat-panel-start-page-tab-runtime",
      },
    ],
    [t]
  );

  const handleTabChange = useCallback(
    (key: string) => {
      setActiveTab(key as typeof activeTab);
    },
    [setActiveTab]
  );

  const workActions: ChatPanelStartPageAction[] = [
    {
      id: "new-work-item",
      title: t("chat.startPage.newWorkItem.title"),
      icon: <BriefcaseBusiness size={16} strokeWidth={1.8} />,
      onClick: onNewWorkItem,
      tone: "primary",
    },
    {
      id: "add-api-key",
      title: t("chat.startPage.addApiKey.title"),
      icon: <KeyRound size={16} strokeWidth={1.8} />,
      onClick: onAddApiKey,
      tone: "success",
    },
    ...(availableUpdate?.available
      ? [
          {
            id: "install-latest-update",
            title: t("chat.startPage.installLatestUpdate.title"),
            icon: <Download size={16} strokeWidth={1.8} />,
            onClick: onInstallLatestUpdate,
            tone: "warning" as const,
          },
        ]
      : []),
  ];
  const manageTabActive = activeTab === CHAT_PANEL_START_PAGE_TAB.MANAGE;
  const runtimeTabActive = activeTab === CHAT_PANEL_START_PAGE_TAB.RUNTIME;
  // The Manage dashboard and the Runtime data-source panel both scroll
  // internally (they fill their container), so the body wrapper must not add
  // its own scrollbar for those tabs.
  const bodyOverflowClass =
    manageTabActive || runtimeTabActive ? "overflow-hidden" : "overflow-y-auto";

  return (
    <div
      className={`flex w-full flex-col overflow-hidden ${className ?? ""}`}
      data-testid="chat-panel-start-page"
    >
      <div
        className={`flex shrink-0 justify-center px-4 pb-2 pt-4 ${DETAIL_PANEL_TOKENS.headerWidth}`}
        data-testid="chat-panel-start-page-tabs"
      >
        <TabPill
          variant="simple"
          size="large"
          fillWidth={false}
          tabs={tabs}
          activeTab={activeTab}
          onChange={handleTabChange}
        />
      </div>
      <div className={`min-h-0 flex-1 ${bodyOverflowClass}`}>
        {manageTabActive ? (
          <Suspense fallback={null}>
            <WorkspaceDashboardPanelView />
          </Suspense>
        ) : runtimeTabActive ? (
          <div
            className="relative h-full w-full"
            data-testid="chat-panel-start-page-runtime"
          >
            <Suspense fallback={null}>
              <DataSourcePanel
                headerContent={
                  <div className="flex flex-col gap-3">
                    {/* Heatmap / activity statistics hidden for now — keeping
                        only the quota grid above the scan table. Re-enable by
                        uncommenting <StartPageHeatmap t={t} /> below. */}
                    {/* <StartPageHeatmap t={t} /> */}
                    <StartPageQuotaGrid />
                  </div>
                }
              />
            </Suspense>
          </div>
        ) : (
          <div className="flex min-h-full items-center justify-center">
            {activeTab === CHAT_PANEL_START_PAGE_TAB.WORK && sessionLauncher ? (
              <div
                className="w-full"
                data-testid="chat-panel-start-page-session-launcher"
              >
                {sessionLauncher}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {activeTab === CHAT_PANEL_START_PAGE_TAB.WORK ? (
        <div
          className={`shrink-0 px-4 pb-5 pt-2 ${DETAIL_PANEL_TOKENS.headerWidth}`}
          data-testid="chat-panel-start-page-actions"
        >
          <div className="flex w-full flex-col gap-3">
            <StartPageHintLine t={t} />
            <div className="@container/startactions">
              <div className="grid grid-cols-1 gap-3 @[420px]/startactions:grid-cols-2 @[800px]/startactions:grid-cols-4">
                {workActions.map((action) => (
                  <StartPageActionCard key={action.id} action={action} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
