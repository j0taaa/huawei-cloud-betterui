"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { ConsoleIconButton, ConsoleSelect } from "@/components/console-ui";
import { cn } from "@/lib/utils";

export function ConsoleTablePagination({
  className,
  currentPage,
  endRow,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  showRowRange = false,
  startRow,
  totalPages,
  totalRows,
}: {
  className?: string;
  currentPage: number;
  endRow?: number;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
  onPreviousPage: () => void;
  pageSize: number;
  pageSizeOptions?: number[];
  showRowRange?: boolean;
  startRow?: number;
  totalPages: number;
  totalRows?: number;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end", className)}>
      {showRowRange ? (
        <span className="text-xs font-black uppercase text-[#667085] dark:text-[#98a2b3]">
          {startRow ?? 0}-{endRow ?? 0} of {totalRows ?? 0} rows
        </span>
      ) : null}
      <label className="flex items-center gap-2 text-xs font-black uppercase text-[#667085] dark:text-[#98a2b3]">
        Rows
        <ConsoleSelect
          className="h-9 px-2 normal-case"
          onChange={(event) => onPageSizeChange(Number(event.currentTarget.value))}
          value={pageSize}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </ConsoleSelect>
      </label>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="text-xs font-black uppercase text-[#667085] dark:text-[#98a2b3]">
          Page {currentPage} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <ConsoleIconButton
            aria-label="Previous table page"
            className="size-9 rounded-lg disabled:cursor-not-allowed disabled:opacity-45"
            disabled={currentPage <= 1}
            onClick={onPreviousPage}
            variant="neutral"
          >
            <ChevronLeft className="size-4" />
          </ConsoleIconButton>
          <ConsoleIconButton
            aria-label="Next table page"
            className="size-9 rounded-lg disabled:cursor-not-allowed disabled:opacity-45"
            disabled={currentPage >= totalPages}
            onClick={onNextPage}
            variant="neutral"
          >
            <ChevronRight className="size-4" />
          </ConsoleIconButton>
        </div>
      </div>
    </div>
  );
}
