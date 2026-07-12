/**
 * DataSourcePanel
 *
 * "Data Sources" tab of the Kanban station. A single inventory of every
 * external coding tool ORGII detects, driven by the one shared detect pipeline
 * (`external_cli_sources_detect`). Sources ORGII can actually read history from
 * (the importable apps: Cursor, Codex, Claude, OpenCode, Windsurf, WorkBuddy)
 * show their imported-session count; the rest show install status. Every row
 * shows the on-disk path + file type and can be rescanned.
 *
 * Rescan re-runs detection for the source (install status / path). For
 * importable sources it also clears the cached metadata
 * (`external_history_rescan_source`) and forces a fresh sidebar load so the
 * store is re-read and the cache repopulated — so a newly-installed tool or a
 * freshly-created store is picked up even when nothing was found before.
 */
import { RefreshCw, Terminal } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ExternalCliSourceProbe,
  type ExternalSourceStats,
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  type ImportedHistorySourceId,
  externalCliSourceProbe,
  externalCliSourcesDetect,
  externalHistoryRescanSource,
  fetchExternalSourceStats,
} from "@src/api/tauri/externalHistory";
import Button from "@src/components/Button";
import ModelIcon, { type IconProvider } from "@src/components/ModelIcon";
import StatusBadge, { type StatusType } from "@src/components/StatusBadge";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { loadSidebarSessions } from "@src/store/session";

// The sources ORGII imports history from (have a cache + support Rescan).
const IMPORTABLE_SOURCE_IDS = new Set<ImportedHistorySourceId>(
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS.map((d) => d.sourceId)
);

function isImportableId(id: string): id is ImportedHistorySourceId {
  return IMPORTABLE_SOURCE_IDS.has(id as ImportedHistorySourceId);
}

const STORE_KIND_LABELS: Record<string, string> = {
  jsonl: "JSONL",
  sqlite: "SQLite",
  json: "JSON",
  markdown: "Markdown",
};

interface SourceRow {
  probe: ExternalCliSourceProbe;
  importable: boolean;
  stats: ExternalSourceStats | null;
  statsLoading: boolean;
  rescanning: boolean;
  error: boolean;
}

/** Collapse an absolute home path to a leading `~/` for display. */
function tildePath(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+)\//, "~/");
}

const SourceIcon: React.FC<{ probe: ExternalCliSourceProbe }> = ({ probe }) => (
  <ModelIcon
    provider={probe.iconId as IconProvider}
    size={16}
    fallback={<Terminal size={16} className="text-text-3" />}
  />
);

const DataSourcePanel: React.FC = () => {
  const { t } = useTranslation("sessions", {
    keyPrefix: "kanban.dataSource",
  });
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [rescanningAll, setRescanningAll] = useState(false);

  const patchRow = useCallback(
    (sourceId: string, patch: Partial<SourceRow>) => {
      setRows((prev) =>
        prev
          ? prev.map((row) =>
              row.probe.sourceId === sourceId ? { ...row, ...patch } : row
            )
          : prev
      );
    },
    []
  );

  const loadStats = useCallback(
    async (sourceId: ImportedHistorySourceId) => {
      patchRow(sourceId, { statsLoading: true, error: false });
      try {
        const stats = await fetchExternalSourceStats(sourceId);
        patchRow(sourceId, { stats, statsLoading: false });
      } catch {
        patchRow(sourceId, { statsLoading: false, error: true });
      }
    },
    [patchRow]
  );

  // Initial load: detect the full inventory, then fetch stats for importables.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let probes: ExternalCliSourceProbe[] = [];
      try {
        probes = await externalCliSourcesDetect();
      } catch {
        if (!cancelled) setRows([]);
        return;
      }
      if (cancelled) return;
      const built: SourceRow[] = probes
        .map((probe) => ({
          probe,
          importable: probe.importable && isImportableId(probe.sourceId),
          stats: null,
          statsLoading: probe.importable && isImportableId(probe.sourceId),
          rescanning: false,
          error: false,
        }))
        .sort((a, b) => {
          const rank = (r: SourceRow) =>
            r.importable ? 0 : r.probe.installed ? 1 : 2;
          return (
            rank(a) - rank(b) ||
            a.probe.displayName.localeCompare(b.probe.displayName)
          );
        });
      setRows(built);
      await Promise.all(
        built
          .filter((r) => r.importable && isImportableId(r.probe.sourceId))
          .map((r) => loadStats(r.probe.sourceId as ImportedHistorySourceId))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStats]);

  // Re-run detection for one source (install status, path, store kind).
  const reprobe = useCallback(
    async (sourceId: string) => {
      try {
        const probe = await externalCliSourceProbe(sourceId);
        if (probe) patchRow(sourceId, { probe });
      } catch {
        /* keep the last-known probe */
      }
    },
    [patchRow]
  );

  // Every row can be rescanned. Importable sources clear + re-import their
  // history; all sources re-probe detection so a newly-installed tool or a
  // freshly-created store is picked up ("rescan even when not found").
  const handleRescan = useCallback(
    async (row: SourceRow) => {
      const sourceId = row.probe.sourceId;
      patchRow(sourceId, { rescanning: true, error: false });
      try {
        if (row.importable && isImportableId(sourceId)) {
          await externalHistoryRescanSource(sourceId);
          await loadSidebarSessions({ forceRefresh: true });
          await loadStats(sourceId);
        }
        await reprobe(sourceId);
      } catch {
        patchRow(sourceId, { error: true });
      } finally {
        patchRow(sourceId, { rescanning: false });
      }
    },
    [loadStats, patchRow, reprobe]
  );

  const handleRescanAll = useCallback(async () => {
    const current = rows ?? [];
    if (current.length === 0) return;
    setRescanningAll(true);
    setRows(
      (prev) =>
        prev?.map((r) => ({ ...r, rescanning: true, error: false })) ?? prev
    );
    const importables = current
      .filter((r) => r.importable && isImportableId(r.probe.sourceId))
      .map((r) => r.probe.sourceId as ImportedHistorySourceId);
    try {
      await Promise.all(importables.map((s) => externalHistoryRescanSource(s)));
      if (importables.length > 0) {
        await loadSidebarSessions({ forceRefresh: true });
      }
      // Re-detect the whole inventory in one shot, then refresh importable stats.
      const probes = await externalCliSourcesDetect();
      const byId = new Map(probes.map((p) => [p.sourceId, p]));
      setRows(
        (prev) =>
          prev?.map((r) => {
            const probe = byId.get(r.probe.sourceId);
            return probe ? { ...r, probe } : r;
          }) ?? prev
      );
      await Promise.all(importables.map((s) => loadStats(s)));
    } catch {
      // Per-source errors surface via loadStats/reprobe; ignore the aggregate.
    } finally {
      setRows(
        (prev) => prev?.map((r) => ({ ...r, rescanning: false })) ?? prev
      );
      setRescanningAll(false);
    }
  }, [loadStats, rows]);

  const describeRow = useCallback(
    (row: SourceRow): string => {
      const path = row.probe.historyPaths[0]
        ? tildePath(row.probe.historyPaths[0])
        : t("noPath");
      const typeLabel =
        STORE_KIND_LABELS[row.probe.storeKind] ?? row.probe.storeKind;
      return typeLabel ? `${path} · ${typeLabel}` : path;
    },
    [t]
  );

  const rowBadge = (
    row: SourceRow
  ): { status: StatusType; labelKey: string } => {
    if (row.importable) {
      if (row.statsLoading) return { status: "loading", labelKey: "loading" };
      if (row.error) return { status: "error", labelKey: "error" };
      if (row.stats && row.stats.sessionCount > 0) {
        return { status: "success", labelKey: "ready" };
      }
      return { status: "empty", labelKey: "empty" };
    }
    return row.probe.installed
      ? { status: "installed", labelKey: "installed" }
      : { status: "empty", labelKey: "notInstalled" };
  };

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-1">{t("title")}</div>
            <div className="mt-0.5 text-xs text-text-3">{t("description")}</div>
          </div>
          {(rows ?? []).length > 0 && (
            <Button
              variant="secondary"
              size="small"
              loading={rescanningAll}
              icon={<RefreshCw size={14} />}
              onClick={() => void handleRescanAll()}
            >
              {t("rescanAll")}
            </Button>
          )}
        </div>

        <SectionContainer>
          {(rows ?? []).map((row) => {
            const badge = rowBadge(row);
            return (
              <SectionRow
                key={row.probe.sourceId}
                label={
                  <span className="flex items-center gap-2">
                    <SourceIcon probe={row.probe} />
                    {row.probe.displayName}
                  </span>
                }
                description={describeRow(row)}
                truncateLabel
              >
                <div className="flex items-center gap-3">
                  {row.importable && !row.statsLoading && row.stats && (
                    <span className="whitespace-nowrap text-xs text-text-3">
                      {t("sessions", { count: row.stats.sessionCount })}
                    </span>
                  )}
                  <StatusBadge
                    status={badge.status}
                    label={t(`status.${badge.labelKey}`)}
                    showPulse={false}
                    size="sm"
                  />
                  <Button
                    variant="tertiary"
                    appearance="ghost"
                    size="small"
                    loading={row.rescanning}
                    icon={<RefreshCw size={14} />}
                    onClick={() => void handleRescan(row)}
                  >
                    {row.rescanning ? t("rescanning") : t("rescan")}
                  </Button>
                </div>
              </SectionRow>
            );
          })}
        </SectionContainer>
      </div>
    </div>
  );
};

export default DataSourcePanel;
