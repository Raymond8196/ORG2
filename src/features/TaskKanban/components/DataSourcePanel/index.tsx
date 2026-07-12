/**
 * DataSourcePanel
 *
 * "Data Sources" tab of the Kanban station. A single inventory of every
 * external coding tool ORGII detects, driven by the one shared detect pipeline
 * (`external_cli_sources_detect`). Sources ORGII can actually read history from
 * (the importable apps: Cursor, Codex, Claude, OpenCode, Windsurf, WorkBuddy)
 * show their imported-session count + a Rescan action; the rest are shown with
 * install status and the on-disk path we'd read from.
 *
 * Rescan clears the source's cached metadata (`external_history_rescan_source`)
 * then forces a fresh sidebar load so the source's store is re-read and the
 * cache repopulated.
 */
import { RefreshCw, Terminal } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ExternalCliSourceProbe,
  type ExternalSourceStats,
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  type ImportedHistorySourceId,
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

  const handleRescan = useCallback(
    async (sourceId: ImportedHistorySourceId) => {
      patchRow(sourceId, { rescanning: true, error: false });
      try {
        await externalHistoryRescanSource(sourceId);
        await loadSidebarSessions({ forceRefresh: true });
        await loadStats(sourceId);
      } catch {
        patchRow(sourceId, { error: true });
      } finally {
        patchRow(sourceId, { rescanning: false });
      }
    },
    [loadStats, patchRow]
  );

  const handleRescanAll = useCallback(async () => {
    const importables = (rows ?? [])
      .filter((r) => r.importable && isImportableId(r.probe.sourceId))
      .map((r) => r.probe.sourceId as ImportedHistorySourceId);
    if (importables.length === 0) return;
    setRescanningAll(true);
    setRows(
      (prev) =>
        prev?.map((r) =>
          r.importable ? { ...r, rescanning: true, error: false } : r
        ) ?? prev
    );
    try {
      await Promise.all(importables.map((s) => externalHistoryRescanSource(s)));
      await loadSidebarSessions({ forceRefresh: true });
      await Promise.all(importables.map((s) => loadStats(s)));
    } catch {
      // Per-source errors surface via loadStats; ignore the aggregate here.
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

  const importableBadge = (
    row: SourceRow
  ): { status: StatusType; labelKey: string } => {
    if (row.statsLoading) return { status: "loading", labelKey: "loading" };
    if (row.error) return { status: "error", labelKey: "error" };
    if (row.stats && row.stats.sessionCount > 0) {
      return { status: "success", labelKey: "ready" };
    }
    return { status: "empty", labelKey: "empty" };
  };

  const importableCount = (rows ?? []).filter((r) => r.importable).length;

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-1">{t("title")}</div>
            <div className="mt-0.5 text-xs text-text-3">{t("description")}</div>
          </div>
          {importableCount > 0 && (
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
            const badge = row.importable ? importableBadge(row) : null;
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
                  {row.importable ? (
                    <>
                      {!row.statsLoading && row.stats && (
                        <span className="whitespace-nowrap text-xs text-text-3">
                          {t("sessions", { count: row.stats.sessionCount })}
                        </span>
                      )}
                      {badge && (
                        <StatusBadge
                          status={badge.status}
                          label={t(`status.${badge.labelKey}`)}
                          showPulse={false}
                          size="sm"
                        />
                      )}
                      <Button
                        variant="tertiary"
                        appearance="ghost"
                        size="small"
                        loading={row.rescanning}
                        icon={<RefreshCw size={14} />}
                        onClick={() =>
                          void handleRescan(
                            row.probe.sourceId as ImportedHistorySourceId
                          )
                        }
                      >
                        {row.rescanning ? t("rescanning") : t("rescan")}
                      </Button>
                    </>
                  ) : (
                    <StatusBadge
                      status={row.probe.installed ? "installed" : "empty"}
                      label={t(
                        row.probe.installed
                          ? "status.installed"
                          : "status.notInstalled"
                      )}
                      showPulse={false}
                      size="sm"
                    />
                  )}
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
