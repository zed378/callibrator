// src/components/ui/Table/Pagination.tsx
import React from "react";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizes?: number[];
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
}) => {
  const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalItems);

  return (
    <div
      className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 border-t border-border bg-muted/50"
    >
      <div
        className="text-sm font-medium text-muted-foreground"
      >
        Showing{" "}
        <span
          className="font-bold text-foreground"
        >
          {startIndex}
        </span>{" "}
        to{" "}
        <span
          className="font-bold text-foreground"
        >
          {endIndex}
        </span>{" "}
        of{" "}
        <span
          className="font-bold text-foreground"
        >
          {totalItems}
        </span>{" "}
        results
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium text-muted-foreground"
            >
              Per page:
            </span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="px-3 py-2 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring/50 transition-all duration-300 cursor-pointer ring-1 ring-border bg-card text-foreground"
            >
              {pageSizes.map((size) => (
                <option
                  key={size}
                  value={size}
                  className="bg-card text-foreground"
                >
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-95 ring-1 ring-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ««
          </button>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-95 ring-1 ring-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            «
          </button>
          <div
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary"
          >
            <span
              className="text-sm font-bold"
            >
              {currentPage}
            </span>
            <span
              className="text-sm opacity-60"
            >
              / {totalPages}
            </span>
          </div>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-95 ring-1 ring-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            »
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-95 ring-1 ring-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            »»
          </button>
        </div>
      </div>
    </div>
  );
};

export default Pagination;
