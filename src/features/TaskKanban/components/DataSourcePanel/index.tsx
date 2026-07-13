/**
 * DataSourcePanel
 *
 * "Data Sources" tab of the Kanban station. A single inventory of every
 * external coding tool ORGII detects, driven by the one shared detect pipeline
 * (`external_cli_sources_detect`). Importable apps (Cursor, Codex, Claude,
 * OpenCode, Windsurf, WorkBuddy) show their imported-session count and can be
 * enabled/disabled, auto-scanned on a schedule, and rescanned on demand; the
 * rest show install status. Every row shows the on-disk path + file type.
 *
 * Per-source config (enabled / frequency / lastScannedAt) is persisted via
 * `dataSourceConfigAtom`. A disabled source is gated out of `loadSidebarSessions`
 * so its sessions never load anywhere. Rescan re-runs detection; for importable
 * sources it also clears the cache and re-imports.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtom } from "jotai";
import { FolderOpen, RefreshCw, Terminal } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import Select from "@src/components/Select";
import StatusBadge, { type StatusType } from "@src/components/StatusBadge";
import Switch from "@src/components/Switch";
import TabPill, { type TabPillItem } from "@src/components/TabPill";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { loadSidebarSessions } from "@src/store/session";
import {
  type DataSourceConfigMap,
  GLOBAL_FREQUENCIES,
  SOURCE_FREQUENCIES,
  type ScanFrequency,
  type SourceFrequency,
  dataSourceConfigAtom,
  dataSourceGlobalFrequencyAtom,
  getSourceConfig,
} from "@src/store/session/dataSourceConfigAtom";
import { formatRelativeElapsedShort } from "@src/util/data/formatters/date";

type DataSourceTab = "all" | "apps" | "clis";

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
  const [tab, setTab] = useState<DataSourceTab>("all");
  const [configMap, setConfigMap] = useAtom(dataSourceConfigAtom);
  const [globalFrequency, setGlobalFrequency] = useAtom(
    dataSourceGlobalFrequencyAtom
  );

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

  const updateConfig = useCallback(
    (sourceId: string, patch: Partial<DataSourceConfigMap[string]>) => {
      setConfigMap((prev) => ({
        ...prev,
        [sourceId]: { ...getSourceConfig(prev, sourceId), ...patch },
      }));
    },
    [setConfigMap]
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

  // Snapshot config for the initial detect effect without re-running on change.
  const configRef = useRef(configMap);
  configRef.current = configMap;

  // Initial load: detect the full inventory, then fetch stats for enabled
  // importable sources.
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
        .map((probe) => {
          const importable = probe.importable && isImportableId(probe.sourceId);
          const enabled = getSourceConfig(
            configRef.current,
            probe.sourceId
          ).enabled;
          return {
            probe,
            importable,
            stats: null,
            statsLoading: importable && enabled,
            rescanning: false,
            error: false,
          };
        })
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
          .filter(
            (r) =>
              r.importable &&
              isImportableId(r.probe.sourceId) &&
              getSourceConfig(configRef.current, r.probe.sourceId).enabled
          )
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

  // Full manual rescan. Importable sources clear + re-import their history; all
  // sources re-probe so a newly-installed tool or freshly-created store is
  // picked up. Stamps lastScannedAt.
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
        updateConfig(sourceId, { lastScannedAt: Date.now() });
      }
    },
    [loadStats, patchRow, reprobe, updateConfig]
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
      .filter(
        (r) =>
          r.importable &&
          isImportableId(r.probe.sourceId) &&
          getSourceConfig(configRef.current, r.probe.sourceId).enabled
      )
      .map((r) => r.probe.sourceId as ImportedHistorySourceId);
    try {
      await Promise.all(importables.map((s) => externalHistoryRescanSource(s)));
      if (importables.length > 0) {
        await loadSidebarSessions({ forceRefresh: true });
      }
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
      const now = Date.now();
      setConfigMap((prev) => {
        const next = { ...prev };
        for (const s of importables) {
          next[s] = { ...getSourceConfig(prev, s), lastScannedAt: now };
        }
        return next;
      });
    } catch {
      // Per-source errors surface via loadStats/reprobe; ignore the aggregate.
    } finally {
      setRows(
        (prev) => prev?.map((r) => ({ ...r, rescanning: false })) ?? prev
      );
      setRescanningAll(false);
    }
  }, [loadStats, rows, setConfigMap]);

  // Toggle a source on/off. Disabling clears it from the sidebar; enabling
  // loads it and stamps a scan.
  const toggleEnabled = useCallback(
    async (row: SourceRow, enabled: boolean) => {
      const sourceId = row.probe.sourceId;
      updateConfig(sourceId, { enabled });
      // Config write is synchronous in the shared store, so the reload below
      // already respects the new enabled state.
      await loadSidebarSessions({ forceRefresh: true });
      if (enabled) {
        if (row.importable && isImportableId(sourceId)) {
          await loadStats(sourceId);
          updateConfig(sourceId, { lastScannedAt: Date.now() });
        }
      } else {
        patchRow(sourceId, { stats: null });
      }
    },
    [loadStats, patchRow, updateConfig]
  );

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

  const openFolder = useCallback((path: string) => {
    void invoke("open_folder", { path }).catch(() => {
      /* best-effort reveal */
    });
  }, []);

  const tabs = useMemo<TabPillItem[]>(
    () => [
      { key: "all", label: t("tabs.all") },
      { key: "apps", label: t("tabs.apps") },
      { key: "clis", label: t("tabs.clis") },
    ],
    [t]
  );

  const sourceFrequencyOptions = useMemo(
    () => SOURCE_FREQUENCIES.map((f) => ({ value: f, label: t(`freq.${f}`) })),
    [t]
  );
  const globalFrequencyOptions = useMemo(
    () => GLOBAL_FREQUENCIES.map((f) => ({ value: f, label: t(`freq.${f}`) })),
    [t]
  );

  const visibleRows = (rows ?? []).filter((row) =>
    tab === "apps" ? row.importable : tab === "clis" ? !row.importable : true
  );

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-1">{t("title")}</div>
            <div className="mt-0.5 text-xs text-text-3">{t("description")}</div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="whitespace-nowrap text-xs text-text-3">
              {t("globalFrequency")}
            </span>
            <Select
              value={globalFrequency}
              onChange={(v) => {
                if (typeof v === "string") {
                  setGlobalFrequency(v as ScanFrequency);
                }
              }}
              options={globalFrequencyOptions}
              size="small"
              style={{ width: 128 }}
              aria-label={t("globalFrequency")}
            />
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
        </div>

        <TabPill
          activeTab={tab}
          tabs={tabs}
          onChange={(key) => setTab(key as DataSourceTab)}
          variant="pill"
          color="fill"
          fillWidth={false}
          size="small"
        />

        <SectionContainer>
          {visibleRows.map((row) => {
            const sourceId = row.probe.sourceId;
            const cfg = getSourceConfig(configMap, sourceId);
            const disabled = row.importable && !cfg.enabled;
            const badge = disabled
              ? { status: "disabled" as StatusType, labelKey: "disabled" }
              : row.importable
                ? importableBadge(row)
                : row.probe.installed
                  ? { status: "installed" as StatusType, labelKey: "installed" }
                  : { status: "empty" as StatusType, labelKey: "notInstalled" };
            const path = row.probe.historyPaths[0];
            const lastScanText = cfg.lastScannedAt
              ? t("lastScan", {
                  time: formatRelativeElapsedShort(new Date(cfg.lastScannedAt)),
                })
              : t("neverScanned");
            const description = row.importable
              ? `${describeRow(row)} · ${lastScanText}`
              : describeRow(row);

            return (
              <SectionRow
                key={sourceId}
                className={disabled ? "opacity-55" : ""}
                label={
                  <span className="flex items-center gap-2">
                    <SourceIcon probe={row.probe} />
                    {row.probe.displayName}
                  </span>
                }
                description={description}
                truncateLabel
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {row.importable &&
                    !disabled &&
                    !row.statsLoading &&
                    row.stats && (
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
                  {row.importable && !disabled && (
                    <Select
                      value={cfg.frequency}
                      onChange={(v) => {
                        if (typeof v === "string") {
                          updateConfig(sourceId, {
                            frequency: v as SourceFrequency,
                          });
                        }
                      }}
                      options={sourceFrequencyOptions}
                      size="small"
                      style={{ width: 128 }}
                      aria-label={t("frequencyTitle")}
                    />
                  )}
                  {path && (
                    <Button
                      variant="secondary"
                      size="small"
                      iconOnly
                      icon={<FolderOpen size={14} />}
                      title={t("openFolder")}
                      onClick={() => openFolder(path)}
                    />
                  )}
                  {!disabled && (
                    <Button
                      variant="secondary"
                      size="small"
                      loading={row.rescanning}
                      icon={<RefreshCw size={14} />}
                      onClick={() => void handleRescan(row)}
                    >
                      {row.rescanning ? t("rescanning") : t("rescan")}
                    </Button>
                  )}
                  {row.importable && (
                    <Switch
                      checked={cfg.enabled}
                      onChange={(checked) => void toggleEnabled(row, checked)}
                      size="small"
                      ariaLabel={cfg.enabled ? t("disable") : t("enable")}
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
