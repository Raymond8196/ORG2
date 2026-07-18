import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  UsageSessionRow,
  UsageSessionSort,
} from "@src/api/tauri/usageDashboard";
import Select from "@src/components/Select";
import Table, { type TableColumn } from "@src/components/Table";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";
import { formatRelativeElapsedShort } from "@src/util/data/formatters/date";

import { BucketIcon, bucketLabelKey } from "./usageBuckets";
import { formatPercent, formatTokensShort, formatUsd } from "./usageFormat";

interface UsageSessionsTableProps {
  rows: UsageSessionRow[];
  total: number;
  sort: UsageSessionSort;
  onSortChange: (sort: UsageSessionSort) => void;
  onRowClick: (row: UsageSessionRow) => void;
  language: string;
  selectedSessionId?: string | null;
}

/** Dollar figure: more precision for sub-dollar spend, 2dp otherwise. */
function costLabel(value: number): string {
  return formatUsd(value, value > 0 && value < 1 ? 4 : 2);
}

export default function UsageSessionsTable({
  rows,
  total,
  sort,
  onSortChange,
  onRowClick,
  language,
  selectedSessionId,
}: UsageSessionsTableProps) {
  const { t } = useTranslation("sessions", { keyPrefix: "kanban.dataSource" });

  const columns = useMemo<TableColumn<UsageSessionRow>[]>(
    () => [
      {
        key: "name",
        dataIndex: "name",
        title: t("usage.table.name"),
        render: (_value, record) => (
          <span
            className="block max-w-[220px] truncate text-text-1"
            title={record.name}
          >
            {record.name}
          </span>
        ),
      },
      {
        key: "agent",
        dataIndex: "bucket",
        title: t("usage.table.agent"),
        width: 130,
        render: (_value, record) => (
          <span className="flex items-center gap-1.5 text-text-2">
            <BucketIcon bucket={record.bucket} size={14} />
            {t(bucketLabelKey(record.bucket))}
          </span>
        ),
      },
      {
        key: "model",
        dataIndex: "model",
        title: t("usage.table.model"),
        width: 150,
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
        key: "tokens",
        dataIndex: "realTotalTokens",
        title: t("usage.table.tokens"),
        align: "right",
        width: 90,
        render: (_value, record) => (
          <span className="tabular-nums text-text-1">
            {formatTokensShort(record.realTotalTokens, language)}
          </span>
        ),
      },
      {
        key: "cost",
        dataIndex: "costUsd",
        title: t("usage.table.cost"),
        align: "right",
        width: 90,
        render: (_value, record) => (
          <span className="tabular-nums text-text-1">
            {costLabel(record.costUsd)}
          </span>
        ),
      },
      {
        key: "cacheHit",
        dataIndex: "cacheHitRate",
        title: t("usage.table.cacheHit"),
        align: "right",
        width: 80,
        hideBelow: "sm",
        render: (_value, record) => (
          <span className="tabular-nums text-text-2">
            {formatPercent(record.cacheHitRate)}
          </span>
        ),
      },
      {
        key: "turns",
        dataIndex: "turnCount",
        title: t("usage.table.turns"),
        align: "right",
        width: 64,
        hideBelow: "md",
        render: (_value, record) => (
          <span className="tabular-nums text-text-3">
            {record.turnCount || "—"}
          </span>
        ),
      },
      {
        key: "lastActive",
        dataIndex: "lastActiveMs",
        title: t("usage.table.lastActive"),
        align: "right",
        width: 96,
        hideBelow: "md",
        render: (_value, record) =>
          record.lastActiveMs > 0 ? (
            <span className="text-text-3">
              {formatRelativeElapsedShort(new Date(record.lastActiveMs))}
            </span>
          ) : (
            <span className="text-text-3">—</span>
          ),
      },
    ],
    [t, language]
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
      title={`${t("usage.table.title")} (${total})`}
      actions={
        <Select
          value={sort}
          onChange={(value) => onSortChange(value as UsageSessionSort)}
          options={sortOptions}
          size="small"
        />
      }
    >
      <Table<UsageSessionRow>
        columns={columns}
        data={rows}
        rowKey="sessionId"
        size="small"
        pagination={false}
        onRowClick={onRowClick}
        rowClassName={(record) =>
          record.sessionId === selectedSessionId ? "bg-surface-selected" : ""
        }
      />
    </CollapsibleSection>
  );
}
