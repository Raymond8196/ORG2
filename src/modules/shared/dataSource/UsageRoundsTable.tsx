import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  UsageRoundRow,
  UsageSessionSort,
} from "@src/api/tauri/usageDashboard";
import Select from "@src/components/Select";
import Table, { type TableColumn } from "@src/components/Table";
import Tooltip from "@src/components/Tooltip";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";
import { formatRelativeElapsedShort } from "@src/util/data/formatters/date";

import UsagePricingHint from "./UsagePricingHint";
import { BucketIcon } from "./usageBuckets";
import { formatCacheRW, formatTokensShort, formatUsd } from "./usageFormat";

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

  const columns = useMemo<TableColumn<UsageRoundRow>[]>(
    () => [
      {
        key: "time",
        dataIndex: "createdAtMs",
        title: t("usage.roundsTable.time"),
        width: 96,
        render: (_value, record) =>
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
        dataIndex: "sessionName",
        title: t("usage.roundsTable.session"),
        render: (_value, record) => (
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
        dataIndex: "model",
        title: t("usage.roundsTable.model"),
        width: 150,
        hideBelow: "sm",
        render: (_value, record) => (
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
        dataIndex: "inputTokens",
        title: t("usage.roundsTable.input"),
        align: "right",
        width: 120,
        render: (_value, record) => {
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
        dataIndex: "outputTokens",
        title: t("usage.roundsTable.output"),
        align: "right",
        width: 80,
        hideBelow: "sm",
        render: (_value, record) => (
          <span className="tabular-nums text-text-2">
            {formatTokensShort(record.outputTokens)}
          </span>
        ),
      },
      {
        key: "cost",
        dataIndex: "costUsd",
        title: t("usage.roundsTable.cost"),
        align: "right",
        width: 88,
        render: (_value, record) => (
          <Tooltip
            position="left"
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

  return (
    <CollapsibleSection
      title={`${t("usage.roundsTable.title")} (${total})`}
      actions={
        <Select
          value={sort}
          onChange={(value) => onSortChange(value as UsageSessionSort)}
          options={sortOptions}
          size="small"
        />
      }
    >
      <Table<UsageRoundRow>
        columns={columns}
        data={rows}
        rowKey="roundId"
        size="small"
        pagination={false}
      />
    </CollapsibleSection>
  );
}
