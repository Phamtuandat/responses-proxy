import type { ReactNode } from "react";
import { formatUnknown } from "../lib/format";

type DataTableColumn<Row extends Record<string, unknown>> = {
  key: keyof Row;
  label: string;
  align?: "left" | "right" | "center";
  render?: (value: Row[keyof Row], row: Row) => ReactNode;
};

type DataTableProps<Row extends Record<string, unknown>> = {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  emptyTitle?: string;
  emptyDescription?: string;
};

export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  emptyTitle = "No rows yet",
  emptyDescription = "Data will appear here when the backend reports it.",
}: DataTableProps<Row>) {
  if (!rows.length) {
    return (
      <div className="table-empty">
        <strong>{emptyTitle}</strong>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.align ? `align-${column.align}` : undefined} key={String(column.key)} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => {
                const value = row[column.key];
                return (
                  <td className={column.align ? `align-${column.align}` : undefined} key={String(column.key)}>
                    {column.render ? column.render(value, row) : formatUnknown(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
