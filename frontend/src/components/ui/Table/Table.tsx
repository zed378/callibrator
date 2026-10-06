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

/**
 * A cell with no `render`: an element (or an array of nodes) as-is, anything
 * else as text. P6-02 (ADR-077): this was `String(value)` for everything, so
 * a screen that builds its cells as JSX in `data` (DevicesTable and others)
 * rendered "[object Object]" in every such column — found by the browser
 * smoke (automate/smoke.browser.js), invisible to tests that mock the table.
 */
export const renderCell = (value: unknown): React.ReactNode => {
  if (React.isValidElement(value) || Array.isArray(value)) {
    return value as React.ReactNode;
  }
  return String(value ?? "");
};

export const Table: React.FC<TableProps> = ({
  columns,
  data,
  onRowClick,
  isLoading = false,
  emptyMessage = "No data available",
}) => {
  return (
    // P11-07: at 360 px the table scrolls sideways; a keyboard user must be
    // able to reach and scroll it even when no cell holds a control (axe
    // scrollable-region-focusable, WCAG 2.1.1 — found by automate/p11.browser.mts).
    <div tabIndex={0} className="overflow-x-auto w-full rounded-2xl bg-card shadow-xs">
      <table className="w-full table-fixed border-collapse">
        <thead className="bg-muted border-b border-border">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-6 py-4 text-left text-xs font-bold uppercase tracking-wider min-w-0 text-muted-foreground ${column.className || ""}`}
              >
                {column.header || (
                  // An empty <th> names nothing for a screen reader (axe
                  // empty-table-header); the action column is still a column.
                  <span className="sr-only">
                    {column.key === "actions" ? "Actions" : column.key}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-16 text-center">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="w-9 h-9 border-t-4 border-transparent border-t-primary rounded-full animate-spin"></div>
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
                      : renderCell(row[column.key])}
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
