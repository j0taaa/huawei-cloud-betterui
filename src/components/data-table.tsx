"use client";

import { useMemo, useState, type ReactNode } from "react";

import { ConsoleSearchInput } from "@/components/console-search-input";
import { ConsoleTablePagination } from "@/components/console-table-pagination";
import { ConsoleTableToolbar } from "@/components/console-ui";

export type DataTableColumn<T> = {
  cell: (item: T, index: number) => ReactNode;
  className?: string;
  header: ReactNode;
  headerClassName?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  emptyState: ReactNode;
  getRowClassName?: (item: T, index: number) => string;
  getSearchText?: (item: T) => string;
  getRowKey: (item: T, index: number) => string;
  items: T[];
  pageSizeOptions?: number[];
  searchPlaceholder?: string;
  tableClassName?: string;
  tableMinWidthClassName?: string;
};

const defaultPageSizeOptions = [10, 25, 50, 100];

export function DataTable<T>({
  columns,
  emptyState,
  getRowClassName,
  getSearchText,
  getRowKey,
  items,
  pageSizeOptions = defaultPageSizeOptions,
  searchPlaceholder = "Search table",
  tableClassName = "",
  tableMinWidthClassName = "min-w-[980px]",
}: DataTableProps<T>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeOptions[1] ?? pageSizeOptions[0] ?? 25);
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery || !getSearchText) {
      return items;
    }

    return items.filter((item) =>
      getSearchText(item).toLowerCase().includes(normalizedQuery),
    );
  }, [getSearchText, items, query]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageStart = filteredItems.length ? (effectivePage - 1) * pageSize : 0;
  const pageEnd = Math.min(filteredItems.length, pageStart + pageSize);
  const pageItems = filteredItems.slice(pageStart, pageEnd);

  function updateQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  return (
    <>
      <ConsoleTableToolbar
        actions={
          <ConsoleTablePagination
            currentPage={effectivePage}
            endRow={pageEnd}
            onNextPage={() => setPage((current) => Math.min(totalPages, current + 1))}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
            onPreviousPage={() => setPage((current) => Math.max(1, current - 1))}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            showRowRange
            startRow={filteredItems.length ? pageStart + 1 : 0}
            totalPages={totalPages}
            totalRows={filteredItems.length}
          />
        }
        stackAt="lg"
      >
        {getSearchText ? (
          <ConsoleSearchInput
            className="lg:max-w-xl"
            clearLabel="Clear table search"
            label={searchPlaceholder}
            onValueChange={updateQuery}
            placeholder={searchPlaceholder}
            value={query}
          />
        ) : (
          <div />
        )}
      </ConsoleTableToolbar>

      <div className="overflow-x-auto">
        {filteredItems.length ? (
          <table
            className={`w-full ${tableMinWidthClassName} text-left text-sm ${tableClassName}`}
            data-table-search="off"
          >
            <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
              <tr>
                {columns.map((column, index) => (
                  <th
                    className={`px-5 py-3 ${column.headerClassName ?? ""}`}
                    key={index}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {pageItems.map((item, index) => (
                <tr
                  className={`align-top hover:bg-[#fbfcfe] ${getRowClassName?.(item, pageStart + index) ?? ""}`}
                  key={getRowKey(item, pageStart + index)}
                >
                  {columns.map((column, columnIndex) => (
                    <td
                      className={`px-5 py-4 ${column.className ?? ""}`}
                      key={columnIndex}
                    >
                      {column.cell(item, pageStart + index)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid place-items-center px-6 py-16 text-center">
            {emptyState}
          </div>
        )}
      </div>
    </>
  );
}
