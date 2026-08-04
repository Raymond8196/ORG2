import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  PropertyDropdownField,
  type PropertyDropdownOption,
} from "@src/components/PropertyField/PropertyDropdownField";
import SettingsTable, {
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
  SettingsTablePagination,
  type SettingsTableProps,
} from "@src/components/SettingsTable";
import {
  DETAIL_PANEL_WIDTH_TOKENS,
  ISSUE_PANEL_WIDTH_TOKENS,
} from "@src/config/detailPanelTokens";

export const WORK_MANAGEMENT_TABLE_MAX_WIDTH_CLASS = {
  standard: DETAIL_PANEL_WIDTH_TOKENS.headerWidth,
  wide: ISSUE_PANEL_WIDTH_TOKENS.headerWidth,
} as const;

export type WorkManagementTableMaxWidth =
  keyof typeof WORK_MANAGEMENT_TABLE_MAX_WIDTH_CLASS;

export interface WorkManagementTableStatusSelect {
  value: string;
  label: string;
  icon: ReactNode;
  iconColor?: string;
  valueClassName?: string;
  options: PropertyDropdownOption<string>[];
  onChange: (value: string) => void | Promise<void>;
  readonly?: boolean;
  dataTestId?: string;
}

export interface WorkManagementTableRow {
  key: string;
  id: ReactNode;
  /** Primitive value used by the sortable ID column. Falls back to `id` or `key`. */
  idSortValue?: string | number;
  title: string;
  titleLinkOnRowHover?: boolean;
  contextLeading?: ReactNode;
  metadata?: ReactNode[];
  /** Lets the final context item absorb the remaining title-column width. */
  fillLastMetadata?: boolean;
  tags?: string[];
  assignee?: ReactNode;
  status?: ReactNode;
  statusSelect?: WorkManagementTableStatusSelect;
  updated: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}

export interface WorkManagementTablePagination {
  pageIndex: number;
  pageSize: number;
  total: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  onPageChange: (pageIndex: number) => void;
  totalLabel?: ReactNode;
  pageLabel?: ReactNode;
}

interface WorkManagementTableProps {
  rows: WorkManagementTableRow[];
  searchBar?: SettingsTableProps<WorkManagementTableRow>["searchBar"];
  selectFilters?: SettingsTableProps<WorkManagementTableRow>["selectFilters"];
  selectFiltersExtra?: SettingsTableProps<WorkManagementTableRow>["selectFiltersExtra"];
  loading?: boolean;
  noDataElement?: ReactNode;
  pageSize?: number;
  pageSizeOptions?: number[];
  pagination?: WorkManagementTablePagination;
  maxWidth?: WorkManagementTableMaxWidth;
  testId?: string;
}

export function WorkManagementTable({
  rows,
  searchBar,
  selectFilters,
  selectFiltersExtra,
  loading = false,
  noDataElement,
  pageSize,
  pageSizeOptions,
  pagination,
  maxWidth = "standard",
  testId = "work-management-table",
}: WorkManagementTableProps): ReactNode {
  const { t } = useTranslation("common");
  const hasActions = rows.some((row) => row.actions !== undefined);
  const hasAssignees = rows.some((row) => row.assignee !== undefined);
  const columns = useMemo<SettingsTableColumn<WorkManagementTableRow>[]>(() => {
    const tableColumns: SettingsTableColumn<WorkManagementTableRow>[] = [
      {
        key: "id",
        label: t("workManagementTable.columns.id", { defaultValue: "ID" }),
        width: SETTINGS_TABLE_COL.hug,
        sorter: (left, right) => {
          const getSortValue = (row: WorkManagementTableRow) =>
            row.idSortValue ??
            (typeof row.id === "string" || typeof row.id === "number"
              ? row.id
              : row.key);
          return String(getSortValue(left)).localeCompare(
            String(getSortValue(right)),
            undefined,
            { numeric: true, sensitivity: "base" }
          );
        },
        renderCell: (row) => (
          <div className="min-w-0 truncate py-1 font-medium tabular-nums text-text-2">
            {row.id}
          </div>
        ),
      },
      {
        key: "title",
        label: t("workManagementTable.columns.titleContext", {
          defaultValue: "Title / Context",
        }),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => (
          <div className="w-full min-w-0 py-1">
            <div
              className={`truncate font-semibold text-text-1 ${
                row.titleLinkOnRowHover
                  ? "transition-colors group-hover:text-primary-6 group-hover:underline group-hover:underline-offset-2"
                  : ""
              }`}
              title={row.title}
            >
              {row.title}
            </div>
            {row.contextLeading ||
            (row.metadata && row.metadata.length > 0) ||
            (row.tags && row.tags.length > 0) ? (
              <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
                {row.contextLeading}
                {row.metadata?.map((item, index) => {
                  const fillsRemaining =
                    row.fillLastMetadata && index === row.metadata!.length - 1;
                  return (
                    <span
                      key={index}
                      className={`inline-flex min-w-0 items-center gap-1 text-[11px] text-text-3 ${
                        fillsRemaining ? "flex-1" : "shrink-0"
                      }`}
                    >
                      {index > 0 ? <span aria-hidden>·</span> : null}
                      <span
                        className={
                          fillsRemaining
                            ? "min-w-0 truncate"
                            : "max-w-40 truncate"
                        }
                      >
                        {item}
                      </span>
                    </span>
                  );
                })}
                {row.tags?.map((tag, index) => (
                  <span
                    key={`${tag}-${index}`}
                    className="inline-flex max-w-40 shrink-0 truncate rounded border border-border-1 px-1.5 py-0.5 text-[10px] font-normal leading-none text-text-3"
                    title={tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ),
      },
    ];
    if (hasAssignees) {
      tableColumns.push({
        key: "assignee",
        label: t("workManagementTable.columns.assignee", {
          defaultValue: "Assignee",
        }),
        width: SETTINGS_TABLE_COL.hug,
        renderCell: (row) => row.assignee,
      });
    }
    tableColumns.push(
      {
        key: "status",
        label: t("workManagementTable.columns.status", {
          defaultValue: "Status",
        }),
        width: SETTINGS_TABLE_COL.valueLg,
        renderCell: (row) =>
          row.statusSelect ? (
            <PropertyDropdownField
              {...row.statusSelect}
              searchable={false}
              maxWidthClassName="max-w-[140px]"
              triggerVariant="pill"
              fieldVariant="pill"
              placement="portal"
              borderless
            />
          ) : (
            row.status
          ),
      },
      {
        key: "updated",
        label: t("workManagementTable.columns.updated", {
          defaultValue: "Updated",
        }),
        width: SETTINGS_TABLE_COL.valueMd,
        renderCell: (row) => (
          <span className="whitespace-nowrap text-text-3">{row.updated}</span>
        ),
      }
    );
    if (hasActions) {
      tableColumns.push({
        key: "actions",
        label: "",
        width: SETTINGS_TABLE_COL.hug,
        align: "right",
        renderCell: (row) => row.actions,
      });
    }
    return tableColumns;
  }, [hasActions, hasAssignees, t]);
  const footer = pagination ? (
    <div className="flex h-12 shrink-0 items-center border-t border-border-1 px-4">
      <SettingsTablePagination
        {...pagination}
        onPageSizeChange={() => undefined}
        showTotal={pagination.totalLabel !== undefined}
        showPageSize={false}
      />
    </div>
  ) : undefined;

  return (
    <div
      className={`${WORK_MANAGEMENT_TABLE_MAX_WIDTH_CLASS[maxWidth]} h-full min-h-0 px-4 py-4`}
      data-testid={testId}
    >
      <SettingsTable<WorkManagementTableRow>
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.key}
        fillHeight
        hover
        loading={loading}
        noDataElement={noDataElement}
        searchBar={searchBar}
        selectFilters={selectFilters}
        selectFiltersExtra={selectFiltersExtra}
        inlineHeaderToolbar={Boolean(
          searchBar || selectFilters?.length || selectFiltersExtra
        )}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        footer={footer}
        onRowClick={(row) => row.onClick?.()}
        rowClassName="group"
        className="[&_.table-row:not(:last-child)_.table-td]:!border-b [&_.table-row:not(:last-child)_.table-td]:!border-border-1 [&_.table-row_.table-td:first-child]:!align-top [&_.table-row_.table-td:first-child_.table-td-inner]:!items-start [&_.table-td-inner]:!h-auto [&_.table-td-inner]:w-full [&_.table-td]:!h-auto [&_.table-td]:!py-2"
      />
    </div>
  );
}
