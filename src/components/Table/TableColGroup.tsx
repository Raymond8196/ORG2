import type { HeaderGroup } from "@tanstack/react-table";

import type { ColumnMeta } from "./types";

const TABLE_EXPAND_COL_WIDTH = 28;

interface TableColGroupProps<T> {
  headerGroups: HeaderGroup<T>[];
  hasExpandable: boolean;
  columnWidths?: number[];
}

export function TableColGroup<T>({
  headerGroups,
  hasExpandable,
  columnWidths,
}: TableColGroupProps<T>) {
  const headers = headerGroups[0]?.headers ?? [];

  return (
    <colgroup>
      {hasExpandable && <col style={{ width: TABLE_EXPAND_COL_WIDTH }} />}
      {headers.map((header, index) => {
        const meta = header.column.columnDef.meta as ColumnMeta | undefined;
        const measuredWidth = columnWidths?.[index];
        const width = measuredWidth ?? meta?.width;
        return <col key={header.id} style={width ? { width } : undefined} />;
      })}
    </colgroup>
  );
}
