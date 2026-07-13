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
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import StatusBadge, { type StatusType } from "@src/components/StatusBadge";
import Switch from "@src/components/Switch";
import TabPill, { type TabPillItem } from "@src/components/TabPill";
import {
  SECTION_CONTROL_STYLE,
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
import { copyText } from "@src/util/data/clipboard";
import { formatRelativeElapsedShort } from "@src/util/data/formatters/date";

import DataSourceDetailsCard from "./DataSourceDetailsCard";
import { storeKindLabel, tildePath } from "./sourcePath";

type DataSourceTab = "all" | "apps" | "clis";

// The sources ORGII imports history from (have a cache + support Rescan).
const IMPORTABLE_SOURCE_IDS = new Set<ImportedHistorySourceId>(
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS.map((d) => d.sourceId)
);

function isImportableId(id: string): id is ImportedHistorySourceId {
  return IMPORTABLE_SOURCE_IDS.has(id as ImportedHistorySourceId);
}

interface SourceRow {
  probe: ExternalCliSourceProbe;
  importable: boolean;
  stats: ExternalSourceStats | null;
  statsLoading: boolean;
  rescanning: boolean;
  error: boolean;
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
  const { t: tCommon } = useTranslation("common");
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [rescanningAll, setRescanningAll] = useState(false);
  const [tab, setTab] = useState<DataSourceTab>("all");
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
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
      const typeLabel = storeKindLabel(row.probe);
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
  const importableCount = (rows ?? []).filter((r) => r.importable).length;

  const searchTerm = searchQuery.trim().toLowerCase();
  const searchedRows = searchTerm
    ? visibleRows.filter((row) =>
        [row.probe.displayName, row.probe.sourceId, ...row.probe.historyPaths]
          .join(" ")
          .toLowerCase()
          .includes(searchTerm)
      )
    : visibleRows;

  const badgeFor = (
    row: SourceRow,
    disabled: boolean
  ): { status: StatusType; labelKey: string } => {
    if (disabled) return { status: "disabled", labelKey: "disabled" };
    if (row.importable) return importableBadge(row);
    return row.probe.installed
      ? { status: "installed", labelKey: "installed" }
      : { status: "empty", labelKey: "notInstalled" };
  };

  const columns: SettingsTableColumn<SourceRow>[] = [
    {
      key: "source",
      label: t("col.source"),
      renderCell: (row) => (
        <span className={`${SETTINGS_TABLE_CELL.primaryIcon} min-w-0`}>
          <span className="shrink-0 text-text-2">
            <SourceIcon probe={row.probe} />
          </span>
          <span className="truncate">{row.probe.displayName}</span>
        </span>
      ),
    },
    {
      key: "sessions",
      label: t("col.sessions"),
      width: "84px",
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        return row.importable && !disabled && row.stats ? (
          <span className="tabular-nums text-text-2">
            {row.stats.sessionCount}
          </span>
        ) : null;
      },
    },
    {
      key: "lastScan",
      label: t("col.lastScan"),
      width: "118px",
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        return row.importable && !disabled && cfg.lastScannedAt ? (
          <span className="whitespace-nowrap text-text-3">
            {formatRelativeElapsedShort(new Date(cfg.lastScannedAt))}
          </span>
        ) : null;
      },
    },
    {
      key: "frequency",
      label: t("col.frequency"),
      width: "160px",
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        return row.importable && !disabled ? (
          <Select
            value={cfg.frequency}
            onChange={(v) => {
              if (typeof v === "string") {
                updateConfig(row.probe.sourceId, {
                  frequency: v as SourceFrequency,
                });
              }
            }}
            options={sourceFrequencyOptions}
            size="small"
            style={{ width: "100%" }}
            aria-label={t("frequencyTitle")}
          />
        ) : null;
      },
    },
    {
      key: "status",
      label: t("col.status"),
      width: "104px",
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        const badge = badgeFor(row, disabled);
        return (
          <StatusBadge
            status={badge.status}
            label={t(`status.${badge.labelKey}`)}
            showPulse={false}
            size="sm"
          />
        );
      },
    },
    {
      // Key must stay "actions" — SettingsTable pins the last column when its
      // key ∈ {actions, status, enabled}, keeping these controls visible while
      // the table scrolls horizontally.
      key: "actions",
      label: "",
      width: "128px",
      align: "right",
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        const path = row.probe.historyPaths[0];
        return (
          <div className="flex items-center justify-end gap-1.5">
            {path && (
              <Button
                variant="secondary"
                size="small"
                iconOnly
                icon={<FolderOpen size={14} />}
                title={describeRow(row)}
                onClick={() => openFolder(path)}
              />
            )}
            {!disabled && (
              <Button
                variant="secondary"
                size="small"
                iconOnly
                loading={row.rescanning}
                icon={<RefreshCw size={14} />}
                title={t("rescan")}
                onClick={() => void handleRescan(row)}
              />
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
        );
      },
    },
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
      <div className="mx-auto flex w-full max-w-[932px] flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-1">{t("title")}</div>
          <div className="mt-0.5 text-xs text-text-3">{t("description")}</div>
        </div>

        {importableCount > 0 && (
          <SectionContainer>
            <SectionRow
              label={t("globalFrequency")}
              description={t("globalFrequencyDesc")}
            >
              <Select
                value={globalFrequency}
                onChange={(v) => {
                  if (typeof v === "string") {
                    setGlobalFrequency(v as ScanFrequency);
                  }
                }}
                options={globalFrequencyOptions}
                size="default"
                style={SECTION_CONTROL_STYLE}
                aria-label={t("globalFrequency")}
              />
            </SectionRow>
          </SectionContainer>
        )}

        <SettingsTable<SourceRow>
          columns={columns}
          rows={searchedRows}
          getRowKey={(row) => row.probe.sourceId}
          headerHeight="tall"
          headerBorder
          hover
          loading={rows === null}
          emptyTitle={searchTerm ? tCommon("status.noResults") : undefined}
          searchBar={{
            searchValue: searchQuery,
            searchPlaceholder: tCommon("common.searchPlaceholder"),
            onSearchChange: setSearchQuery,
            onSearchClear: () => setSearchQuery(""),
            rightContent:
              (rows ?? []).length > 0 ? (
                <Button
                  variant="secondary"
                  size="small"
                  loading={rescanningAll}
                  icon={<RefreshCw size={14} />}
                  onClick={() => void handleRescanAll()}
                >
                  {t("rescanAll")}
                </Button>
              ) : undefined,
            tabPills: (
              <TabPill
                activeTab={tab}
                tabs={tabs}
                onChange={(key) => setTab(key as DataSourceTab)}
                variant="pill"
                color="fill"
                fillWidth={false}
                size="small"
              />
            ),
            searchCountText:
              searchTerm && searchedRows.length !== visibleRows.length
                ? `${searchedRows.length} / ${visibleRows.length}`
                : undefined,
          }}
          expandable={{
            expandedRowRender: (row) => (
              <DataSourceDetailsCard
                probe={row.probe}
                stats={row.stats}
                onOpenFolder={openFolder}
                onCopyPath={(path) => void copyText(path)}
              />
            ),
            rowExpandable: (row) => row.probe.historyPaths.length > 0,
            expandedRowKeys,
            onExpandedRowsChange: setExpandedRowKeys,
          }}
        />
      </div>
    </div>
  );
};

export default DataSourcePanel;
