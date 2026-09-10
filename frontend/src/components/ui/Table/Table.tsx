// src/components/ui/Table/Table.tsx
import React from "react";

export interface TableColumn {
  key: string;
  header: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
  className?: string;
  cellClassName?: string;
}

export interface TableProps {
  columns: TableColumn[];
  data: Record<string, unknown>[];
  onRowClick?: (row: Record<string, unknown>) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

export const Table: React.FC<TableProps> = ({
  columns,
  data,
  onRowClick,
  isLoading = false,
  emptyMessage = "No data available",
}) => {
  return (
    <div className="overflow-x-auto w-full rounded-2xl bg-card shadow-xs">
      <table className="w-full table-fixed border-collapse">
        <thead className="bg-muted border-b border-border">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-6 py-4 text-left text-xs font-bold uppercase tracking-wider min-w-0 text-muted-foreground ${column.className || ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-16 text-center">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="w-9 h-9 border-t-4 border-transparent border-t-indigo-600 rounded-full animate-spin"></div>
                  <p className="text-sm font-medium text-muted-foreground animate-pulse">
                    Loading data...
                  </p>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  {emptyMessage}
                </p>
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                onClick={() => onRowClick?.(row)}
                className={`group border-b border-border ${
                  onRowClick
                    ? `cursor-pointer hover:bg-muted/50`
                    : ""
                } transition-colors duration-150`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-6 py-4 whitespace-nowrap text-sm min-w-0 text-foreground group-last:border-0 ${column.className || column.cellClassName || ""}`}
                  >
                    {column.render
                      ? column.render(row[column.key], row)
                      : String(row[column.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default Table;
