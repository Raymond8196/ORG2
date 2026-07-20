import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  UsageRoundRow,
  UsageSessionSort,
} from "@src/api/tauri/usageDashboard";
import SettingsTable, {
  type SettingsTableColumn,
  type SettingsTableSelectFilter,
} from "@src/components/SettingsTable";
import Tooltip from "@src/components/Tooltip";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";
import { formatRelativeElapsedShort } from "@src/util/data/formatters/date";

import UsagePricingHint from "./UsagePricingHint";
import { BucketIcon } from "./usageBuckets";
import { formatCacheRW, formatTokensShort, formatUsd } from "./usageFormat";

const MODEL_ALL = "__all_models__";
const MODEL_UNKNOWN = "__unknown_model__";

interface UsageRoundsTableProps {
  rows: UsageRoundRow[];
  total: number;
  sort: UsageSessionSort;
  onSortChange: (sort: UsageSessionSort) => void;
  /** Click a round's session to scope the whole dashboard to it. */
  onSelectSession: (sessionId: string) => void;
}

/** Dollar figure: more precision for sub-dollar spend, 2dp otherwise. */
function costLabel(value: number): string {
  return formatUsd(value, value > 0 && value < 1 ? 4 : 2);
}

export default function UsageRoundsTable({
  rows,
  total,
  sort,
  onSortChange,
  onSelectSession,
}: UsageRoundsTableProps) {
  const { t } = useTranslation("sessions", { keyPrefix: "kanban.dataSource" });
  const { t: tCommon } = useTranslation("common");
  const [searchQuery, setSearchQuery] = useState("");
  const [modelFilter, setModelFilter] = useState(MODEL_ALL);

  const columns = useMemo<SettingsTableColumn<UsageRoundRow>[]>(
    () => [
      {
        key: "time",
        label: t("usage.roundsTable.time"),
        width: 96,
        renderCell: (record) =>
          record.createdAtMs > 0 ? (
            <span className="text-text-2">
              {formatRelativeElapsedShort(new Date(record.createdAtMs))}
            </span>
          ) : (
            <span className="text-text-3">—</span>
          ),
      },
      {
        key: "session",
        label: t("usage.roundsTable.session"),
        renderCell: (record) => (
          <button
            type="button"
            onClick={() => onSelectSession(record.sessionId)}
            title={t("usage.roundsTable.filterBySession")}
            className="flex items-center gap-1.5 truncate text-left text-text-1 hover:text-primary-6"
          >
            <BucketIcon bucket={record.bucket} size={14} />
            <span className="max-w-[220px] truncate">{record.sessionName}</span>
          </button>
        ),
      },
      {
        key: "model",
        label: t("usage.roundsTable.model"),
        width: 150,
        renderCell: (record) => (
          <span
            className="block max-w-[150px] truncate text-text-3"
            title={record.model ?? ""}
          >
            {record.model || "—"}
          </span>
        ),
      },
      {
        key: "input",
        label: t("usage.roundsTable.input"),
        align: "right",
        width: 120,
        renderCell: (record) => {
          const cache = formatCacheRW(
            record.cacheReadTokens,
            record.cacheWriteTokens
          );
          return (
            <div className="flex flex-col items-end">
              <span className="tabular-nums text-text-2">
                {formatTokensShort(record.inputTokens)}
              </span>
              {cache && (
                <span className="text-[10px] tabular-nums text-text-3">
                  {cache}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "output",
        label: t("usage.roundsTable.output"),
        align: "right",
        width: 80,
        renderCell: (record) => (
          <span className="tabular-nums text-text-2">
            {formatTokensShort(record.outputTokens)}
          </span>
        ),
      },
      {
        key: "cost",
        label: t("usage.roundsTable.cost"),
        align: "right",
        width: 88,
        renderCell: (record) => (
          <Tooltip
            position="bottom"
            mouseEnterDelay={500}
            content={
              <UsagePricingHint
                breakdown={{
                  model: record.model,
                  inputTokens: record.inputTokens,
                  outputTokens: record.outputTokens,
                  cacheReadTokens: record.cacheReadTokens,
                  cacheWriteTokens: record.cacheWriteTokens,
                }}
              />
            }
          >
            <span className="cursor-help tabular-nums text-text-1 underline decoration-text-3 decoration-dotted underline-offset-2">
              {costLabel(record.costUsd)}
            </span>
          </Tooltip>
        ),
      },
    ],
    [t, onSelectSession]
  );

  const sortOptions = useMemo(
    () => [
      { value: "recent", label: t("usage.table.sort.recent") },
      { value: "cost", label: t("usage.table.sort.cost") },
      { value: "tokens", label: t("usage.table.sort.tokens") },
    ],
    [t]
  );

  const modelFilterOptions = useMemo(() => {
    const models = Array.from(
      new Set(rows.map((row) => row.model).filter((model) => model != null))
    ).sort((modelA, modelB) => modelA.localeCompare(modelB));
    const hasUnknownModel = rows.some((row) => row.model == null);

    return [
      {
        value: MODEL_ALL,
        label: tCommon("selectors.modelSelector.allModels"),
      },
      ...models.map((model) => ({ value: model, label: model })),
      ...(hasUnknownModel
        ? [
            {
              value: MODEL_UNKNOWN,
              label: tCommon("status.unknown"),
            },
          ]
        : []),
    ];
  }, [rows, tCommon]);

  const selectFilters = useMemo<SettingsTableSelectFilter[]>(
    () => [
      {
        key: "model",
        value: modelFilter,
        defaultValue: MODEL_ALL,
        options: modelFilterOptions,
        onChange: (value) => setModelFilter(String(value)),
      },
      {
        key: "sort",
        value: sort,
        defaultValue: "recent",
        options: sortOptions,
        onChange: (value) => onSortChange(value as UsageSessionSort),
      },
    ],
    [modelFilter, modelFilterOptions, onSortChange, sort, sortOptions]
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

    return rows.filter((row) => {
      const matchesModel =
        modelFilter === MODEL_ALL ||
        (modelFilter === MODEL_UNKNOWN
          ? row.model == null
          : row.model === modelFilter);
      if (!matchesModel) return false;
      if (!normalizedQuery) return true;

      return [row.sessionName, row.model, row.source].some((value) =>
        value?.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [modelFilter, rows, searchQuery]);

  const isFiltered = searchQuery.trim().length > 0 || modelFilter !== MODEL_ALL;

  return (
    <CollapsibleSection title={`${t("usage.roundsTable.title")} (${total})`}>
      <SettingsTable<UsageRoundRow>
        columns={columns}
        rows={filteredRows}
        getRowKey={(row) => row.roundId}
        inlineHeaderToolbar
        searchBar={{
          searchValue: searchQuery,
          searchPlaceholder: tCommon("common.searchPlaceholder"),
          onSearchChange: setSearchQuery,
          onSearchClear: () => setSearchQuery(""),
          searchInputSize: "default",
        }}
        selectFilters={selectFilters}
        hover
        headerHeight="tall"
        emptyTitle={isFiltered ? tCommon("status.noResults") : undefined}
      />
    </CollapsibleSection>
  );
}
