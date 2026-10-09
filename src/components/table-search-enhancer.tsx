"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Cloud,
  Database,
  Filter,
  Globe2,
  HardDrive,
  Image as ImageIcon,
  Lock,
  Server,
  ShieldCheck,
  Timer,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { ConsoleButton, ConsoleCheckboxOption, ConsoleFloatingMenuPanel, ConsoleIconButton, ConsoleInsetPanel, ConsoleListOptionButton, ConsoleRemovablePill } from "@/components/console-ui";
import { ConsoleSearchInput } from "@/components/console-search-input";
import { ConsoleTablePagination } from "@/components/console-table-pagination";

type MountedSearch = {
  container: HTMLElement;
  root: Root;
};

const mountedSearches = new WeakMap<HTMLTableElement, MountedSearch>();

type ColumnOption = {
  index: number;
  label: string;
};

type TableFilterState = {
  query: string;
  valueFilters: Record<string, string[]>;
};

type TableViewState = TableFilterState & {
  page: number;
  pageSize: number;
};

type TableViewResult = {
  filteredCount: number;
  page: number;
  totalPages: number;
  visibleCount: number;
};

type MenuPosition = {
  left: number;
  top: number;
};

type CellDecoration = {
  className: string;
  icon: React.ReactNode;
};

const iconClass = "size-3.5 shrink-0";

function searchableRows(table: HTMLTableElement) {
  return Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
}

function tableTitle(table: HTMLTableElement) {
  const section = table.closest("section");
  const heading = section?.querySelector("h2, h3")?.textContent?.trim();

  if (heading) {
    return heading;
  }

  const firstHeader = table.querySelector("thead th")?.textContent?.trim();
  return firstHeader ? `${firstHeader} table` : "table";
}

function ensureEmptyState(table: HTMLTableElement) {
  const existing = table.nextElementSibling;

  if (existing instanceof HTMLElement && existing.dataset.tableSearchEmpty === "true") {
    return existing;
  }

  const empty = document.createElement("div");
  empty.className =
    "hidden border-t border-[#eef2f7] px-5 py-6 text-center text-sm font-bold text-[#667085]";
  empty.dataset.tableSearchEmpty = "true";
  empty.textContent = "No rows match this search.";
  table.insertAdjacentElement("afterend", empty);

  return empty;
}

function tableColumns(table: HTMLTableElement) {
  const headers = Array.from(table.tHead?.rows[0]?.cells ?? []);

  return headers
    .map((header, index): ColumnOption => {
      const label = header.textContent?.trim() || `Column ${index + 1}`;
      return { index, label };
    })
    .filter((column) => column.label.toLowerCase() !== "actions");
}

function rowText(row: HTMLTableRowElement, columns: number[]) {
  const cells = Array.from(row.cells);
  const scopedCells = columns.length
    ? columns.map((index) => cells[index]).filter(Boolean)
    : cells;

  return scopedCells.map((cell) => cell.textContent ?? "").join(" ");
}

function cellText(row: HTMLTableRowElement, index: number) {
  return row.cells[index]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function columnValues(table: HTMLTableElement, index: number) {
  return Array.from(
    new Set(
      searchableRows(table)
        .map((row) => cellText(row, index))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function rowMatches(row: HTMLTableRowElement, state: TableFilterState) {
  const query = state.query.trim();
  const normalized = query.toLowerCase();
  const haystack = rowText(row, []).toLowerCase();

  if (normalized && !haystack.includes(normalized)) {
    return false;
  }

  return Object.entries(state.valueFilters).every(([index, selectedValues]) => {
    if (!selectedValues.length) {
      return false;
    }

    return selectedValues.includes(cellText(row, Number(index)));
  });
}

function matchingRowCount(table: HTMLTableElement, state: TableFilterState) {
  return searchableRows(table).filter((row) => rowMatches(row, state)).length;
}

function applyTableView(table: HTMLTableElement, state: TableViewState): TableViewResult {
  const rows = searchableRows(table);
  const empty = ensureEmptyState(table);
  const matchingRows = rows.filter((row) => rowMatches(row, state));
  const filteredCount = matchingRows.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / state.pageSize));
  const page = Math.min(Math.max(1, state.page), totalPages);
  const start = (page - 1) * state.pageSize;
  const visibleRows = new Set(matchingRows.slice(start, start + state.pageSize));

  for (const row of rows) {
    const isVisible = visibleRows.has(row);
    row.hidden = !isVisible;
    row.style.display = isVisible ? "" : "none";
  }

  empty.classList.toggle("hidden", filteredCount > 0 || rows.length === 0);
  table.dataset.filteredRows = String(filteredCount);
  table.dataset.visibleRows = String(visibleRows.size);

  return {
    filteredCount,
    page,
    totalPages,
    visibleCount: visibleRows.size,
  };
}

function decorationForValue(value: string, columnLabel: string): CellDecoration | null {
  const text = value.trim();
  const normalized = text.toLowerCase();
  const column = columnLabel.toLowerCase();

  if (!text || text === "-") {
    return null;
  }

  if (
    ["active", "available", "running", "normal", "enabled", "healthy", "in-use", "success", "succeeded"].includes(
      normalized,
    )
  ) {
    return {
      className: "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
      icon: <CheckCircle2 className={iconClass} />,
    };
  }

  if (
    ["stopped", "shutoff", "disabled", "frozen", "hibernate", "hibernating", "deleted"].includes(
      normalized,
    )
  ) {
    return {
      className: "border-[#e4e7ec] bg-[#f2f4f7] text-[#667085]",
      icon: <CircleDashed className={iconClass} />,
    };
  }

  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("fault") ||
    normalized.includes("abnormal") ||
    normalized.includes("unavailable")
  ) {
    return {
      className: "border-[#fecdd3] bg-[#fff1f2] text-[#b42318]",
      icon: <XCircle className={iconClass} />,
    };
  }

  if (
    normalized.includes("creating") ||
    normalized.includes("pending") ||
    normalized.includes("starting") ||
    normalized.includes("reboot") ||
    normalized.includes("backup") ||
    normalized.includes("restoring") ||
    normalized.includes("deleting")
  ) {
    return {
      className: "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]",
      icon: <Timer className={iconClass} />,
    };
  }

  if (["yes", "true", "public", "shared"].includes(normalized)) {
    return {
      className: "border-[#bae6fd] bg-[#ecfeff] text-[#0e7490]",
      icon: <ShieldCheck className={iconClass} />,
    };
  }

  if (["no", "false", "private"].includes(normalized)) {
    return {
      className: "border-[#e4e7ec] bg-white text-[#475467]",
      icon: <Lock className={iconClass} />,
    };
  }

  if (column.includes("image") || normalized.includes("ubuntu") || normalized.includes("windows")) {
    return {
      className: "border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9]",
      icon: <ImageIcon className={iconClass} />,
    };
  }

  if (column.includes("disk") || column.includes("storage") || column.includes("volume")) {
    return {
      className: "border-[#c7d2fe] bg-[#eef2ff] text-[#4338ca]",
      icon: <HardDrive className={iconClass} />,
    };
  }

  if (column.includes("type") || column.includes("flavor") || column.includes("spec")) {
    return {
      className: "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]",
      icon: <Zap className={iconClass} />,
    };
  }

  if (column.includes("ip") || column.includes("endpoint") || column.includes("domain")) {
    return {
      className: "border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]",
      icon: <Globe2 className={iconClass} />,
    };
  }

  if (column.includes("project") || column.includes("region") || column.includes("az")) {
    return {
      className: "border-[#fed7aa] bg-[#fffbeb] text-[#b45309]",
      icon: <Cloud className={iconClass} />,
    };
  }

  if (column.includes("node") || column.includes("server") || column.includes("instance")) {
    return {
      className: "border-[#d9e0eb] bg-[#f8fafc] text-[#344054]",
      icon: <Server className={iconClass} />,
    };
  }

  if (column.includes("record") || column.includes("count") || /^\d+(\.\d+)?(\s*(gb|mb|tb|kib|mib|gib))?$/i.test(text)) {
    return {
      className: "border-[#e9d5ff] bg-[#faf5ff] text-[#7e22ce]",
      icon: <Database className={iconClass} />,
    };
  }

  if (normalized.includes("warning") || normalized.includes("locked")) {
    return {
      className: "border-[#fde68a] bg-[#fffbeb] text-[#b45309]",
      icon: <AlertTriangle className={iconClass} />,
    };
  }

  return null;
}

function shouldDecorateCell(cell: HTMLTableCellElement, columnLabel: string) {
  if (cell.dataset.tableDecorated === "true") {
    return false;
  }

  if (columnLabel.toLowerCase() === "actions") {
    return false;
  }

  if (cell.querySelector("button, input, select, textarea, [role='button'], [data-table-search='true']")) {
    return false;
  }

  if (cell.children.length > 1) {
    return false;
  }

  if (cell.querySelector("a")) {
    return false;
  }

  const text = cell.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length > 0 && text.length <= 80 && !text.includes("\n");
}

function decorateTableCells(table: HTMLTableElement) {
  const columns = tableColumns(table);
  const rows = searchableRows(table);

  for (const row of rows) {
    for (const column of columns) {
      const cell = row.cells[column.index];

      if (!(cell instanceof HTMLTableCellElement) || !shouldDecorateCell(cell, column.label)) {
        continue;
      }

      const text = cell.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const decoration = decorationForValue(text, column.label);

      if (!decoration) {
        continue;
      }

      const originalClassName = cell.className;
      const wrapper = document.createElement("span");
      const wrapperRoot = createRoot(wrapper);

      cell.textContent = "";
      cell.className = originalClassName
        .split(" ")
        .filter((className) => !className.startsWith("font-") && !className.startsWith("text-[#"))
        .join(" ");
      cell.appendChild(wrapper);
      cell.dataset.tableDecorated = "true";
      wrapperRoot.render(
        <span
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${decoration.className}`}
        >
          {decoration.icon}
          <span className="truncate">{text}</span>
        </span>,
      );
    }
  }
}

function menuPositionFor(button: HTMLButtonElement | null): MenuPosition | null {
  if (!button) {
    return null;
  }

  const rect = button.getBoundingClientRect();
  const menuWidth = Math.min(576, window.innerWidth - 32);
  const left = Math.min(
    Math.max(16, rect.left),
    Math.max(16, window.innerWidth - menuWidth - 16),
  );
  const top = Math.min(rect.bottom + 8, window.innerHeight - 96);

  return { left, top };
}

function FilterMenu({
  anchor,
  clearSearch,
  columns,
  setMenuOpen,
  table,
  valueFilters,
  setValueFilters,
}: {
  anchor: HTMLButtonElement | null;
  clearSearch: () => void;
  columns: ColumnOption[];
  setMenuOpen: (value: boolean) => void;
  table: HTMLTableElement;
  valueFilters: Record<string, string[]>;
  setValueFilters: Dispatch<SetStateAction<Record<string, string[]>>>;
}) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState(
    columns[0]?.index ?? 0,
  );
  const [valueSearch, setValueSearch] = useState("");
  const selectedColumn =
    columns.find((column) => column.index === selectedColumnIndex) ?? columns[0];
  const values = useMemo(
    () => (selectedColumn ? columnValues(table, selectedColumn.index) : []),
    [selectedColumn, table],
  );
  const selectedValues = selectedColumn
    ? valueFilters[String(selectedColumn.index)]
    : undefined;
  const effectiveSelectedValues = selectedValues ?? values;
  const visibleValues = values.filter((value) =>
    value.toLowerCase().includes(valueSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    function updatePosition() {
      setPosition(menuPositionFor(anchor));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        anchor?.contains(target) ||
        document
          .querySelector("[data-table-filter-menu='true']")
          ?.contains(target)
      ) {
        return;
      }

      setMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [anchor, setMenuOpen]);

  if (!position) {
    return null;
  }

  function selectAllValues() {
    if (!selectedColumn) {
      return;
    }

    setValueFilters((current) => {
      const next = { ...current };
      delete next[String(selectedColumn.index)];
      return next;
    });
  }

  function clearColumnValues() {
    if (!selectedColumn) {
      return;
    }

    setValueFilters((current) => ({
      ...current,
      [String(selectedColumn.index)]: [],
    }));
  }

  function toggleValue(value: string) {
    if (!selectedColumn) {
      return;
    }

    const key = String(selectedColumn.index);
    setValueFilters((current) => {
      const currentValues = current[key] ?? values;
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true }),
          );
      const next = { ...current };

      if (nextValues.length === values.length) {
        delete next[key];
      } else {
        next[key] = nextValues;
      }

      return next;
    });
  }

  return createPortal(
    <ConsoleFloatingMenuPanel
      className="fixed z-[1000] w-[min(36rem,calc(100vw-2rem))] rounded-xl p-4 text-sm shadow-2xl"
      data-table-filter-menu="true"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black">Filters</p>
          <p className="mt-1 text-xs font-semibold text-[#667085]">
            Select table values, similar to spreadsheet filters.
          </p>
        </div>
        <ConsoleIconButton
          aria-label="Close table filters"
          onClick={() => setMenuOpen(false)}
        >
          <X className="size-4" />
        </ConsoleIconButton>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[12rem_1fr]">
        <div className="grid max-h-[min(20rem,calc(100vh-16rem))] gap-1 overflow-auto pr-1">
          {columns.map((column) => {
            const filter = valueFilters[String(column.index)];
            const active = column.index === selectedColumn?.index;
            return (
              <ConsoleListOptionButton
                active={active}
                badge={filter?.length}
                key={column.index}
                onClick={() => {
                  setSelectedColumnIndex(column.index);
                  setValueSearch("");
                }}
              >
                {column.label}
              </ConsoleListOptionButton>
            );
          })}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-black">
              {selectedColumn?.label ?? "Column"}
            </p>
            <div className="flex shrink-0 gap-2">
              <ConsoleButton
                onClick={selectAllValues}
                size="xs"
                variant="neutral"
              >
                Select all
              </ConsoleButton>
              <ConsoleButton
                onClick={clearColumnValues}
                size="xs"
                variant="neutral"
              >
                Clear
              </ConsoleButton>
            </div>
          </div>

          <ConsoleSearchInput
            className="mt-3"
            clearLabel="Clear value search"
            label="Search filter values"
            onValueChange={setValueSearch}
            placeholder="Search values"
            value={valueSearch}
          />

          <div className="mt-3 grid max-h-[min(16rem,calc(100vh-20rem))] gap-2 overflow-auto pr-1">
            {visibleValues.map((value) => (
              <ConsoleCheckboxOption
                checked={effectiveSelectedValues.includes(value)}
                key={value}
                label={value}
                onChange={() => toggleValue(value)}
              />
            ))}
            {!visibleValues.length ? (
              <ConsoleInsetPanel className="rounded-lg px-3 py-6 text-center text-sm font-bold text-[#667085]">
                No values found.
              </ConsoleInsetPanel>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#eef2f7] pt-3">
        <p className="text-xs font-bold text-[#667085]">
          {Object.keys(valueFilters).length} column filters applied
        </p>
        <ConsoleButton
          onClick={clearSearch}
          size="sm"
          variant="neutral"
        >
          Reset
        </ConsoleButton>
      </div>
    </ConsoleFloatingMenuPanel>,
    document.body,
  );
}

function TableSearchControl({
  count,
  label,
  table,
}: {
  count: number;
  label: string;
  table: HTMLTableElement;
}) {
  const columns = useMemo(() => tableColumns(table), [table]);
  const [rowCount, setRowCount] = useState(count);
  const [filterButton, setFilterButton] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [query, setQuery] = useState("");
  const [, setTableRevision] = useState(0);
  const [valueFilters, setValueFilters] = useState<Record<string, string[]>>({});
  const appliedFilters = useMemo(
    () =>
      Object.entries(valueFilters)
        .map(([index, values]) => ({
          column: columns.find((column) => column.index === Number(index)),
          index,
          values,
        }))
        .filter((filter) => filter.column),
    [columns, valueFilters],
  );
  const hasFilters = appliedFilters.length > 0;
  const filterState = useMemo(
    () => ({
      query,
      valueFilters,
    }),
    [query, valueFilters],
  );
  const filteredCount = matchingRowCount(table, filterState);
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageStart = filteredCount ? (effectivePage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(filteredCount, effectivePage * pageSize);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setRowCount(searchableRows(table).length);
      setTableRevision((revision) => revision + 1);
    });

    for (const body of Array.from(table.tBodies)) {
      observer.observe(body, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
    };
  }, [table]);

  useEffect(() => {
    applyTableView(table, {
      ...filterState,
      page: effectivePage,
      pageSize,
    });
  }, [effectivePage, filterState, pageSize, table, rowCount]);

  function clearSearch() {
    setQuery("");
    setValueFilters({});
    setPage(1);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function updateValueFilters(
    update: SetStateAction<Record<string, string[]>>,
  ) {
    setValueFilters(update);
    setPage(1);
  }

  function removeColumnFilter(index: string) {
    updateValueFilters((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  return (
    <div className="border-t border-[#eef2f7] bg-white px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <ConsoleSearchInput
            className="sm:max-w-xl"
            clearLabel="Clear table search"
            label={`Search ${label}`}
            onValueChange={updateQuery}
            placeholder={`Search ${label}`}
            value={query}
          />

          <div className="relative flex items-center gap-2">
            <ConsoleIconButton
              aria-expanded={menuOpen}
              aria-label="Table filters"
              className="size-10 rounded-lg"
              onClick={() => setMenuOpen((open) => !open)}
              ref={setFilterButton}
              title="Table filters"
              variant={hasFilters ? "primaryOutline" : "neutral"}
            >
              <Filter className="size-4" />
            </ConsoleIconButton>

            {menuOpen ? (
              <FilterMenu
                anchor={filterButton}
                clearSearch={clearSearch}
                columns={columns}
                setMenuOpen={setMenuOpen}
                setValueFilters={updateValueFilters}
                table={table}
                valueFilters={valueFilters}
              />
            ) : null}
          </div>

          {appliedFilters.length ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {appliedFilters.map((filter) => (
                <ConsoleRemovablePill
                  key={filter.index}
                  onRemove={() => removeColumnFilter(filter.index)}
                  removeLabel={`Remove ${filter.column?.label} filter`}
                >
                  {filter.column?.label}:{" "}
                  {filter.values.length ? filter.values.slice(0, 2).join(", ") : "none"}
                  {filter.values.length > 2 ? ` +${filter.values.length - 2}` : ""}
                </ConsoleRemovablePill>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3 text-xs font-black uppercase text-[#667085]">
          <span>
            {pageStart}-{pageEnd} of {filteredCount} rows
            {filteredCount !== rowCount ? ` (${rowCount} total)` : ""}
          </span>
          {hasFilters || query ? (
            <ConsoleButton
              onClick={clearSearch}
              size="xs"
              variant="neutral"
            >
              <X className="size-3.5" />
              Clear
            </ConsoleButton>
          ) : null}
        </div>
      </div>

      <ConsoleTablePagination
        className="mt-3 border-t border-[#eef2f7] pt-3"
        currentPage={effectivePage}
        onNextPage={() => setPage((current) => Math.min(totalPages, current + 1))}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        onPreviousPage={() => setPage((current) => Math.max(1, current - 1))}
        pageSize={pageSize}
        totalPages={totalPages}
      />
    </div>
  );
}

function targetForTable(table: HTMLTableElement) {
  const scrollContainer = table.closest(".overflow-x-auto");

  if (scrollContainer instanceof HTMLElement) {
    return scrollContainer;
  }

  return table;
}

function enhanceTable(table: HTMLTableElement) {
  if (mountedSearches.has(table) || table.dataset.tableSearch === "off") {
    return;
  }

  const rows = searchableRows(table);

  if (!rows.length) {
    return;
  }

  decorateTableCells(table);

  const container = document.createElement("div");
  container.dataset.tableSearch = "true";
  targetForTable(table).insertAdjacentElement("beforebegin", container);

  const root = createRoot(container);
  root.render(
    <TableSearchControl
      count={rows.length}
      label={tableTitle(table)}
      table={table}
    />,
  );
  mountedSearches.set(table, { container, root });
}

function enhanceTables() {
  document.querySelectorAll<HTMLTableElement>("table").forEach(enhanceTable);
}

export function TableSearchEnhancer() {
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;

    const startEnhancer = () => {
      enhanceTables();

      observer = new MutationObserver(() => {
        enhanceTables();
      });

      observer.observe(document.body, { childList: true, subtree: true });
    };

    const scheduleEnhancer = () => {
      timeoutId = window.setTimeout(startEnhancer, 750);
    };

    if (document.readyState === "complete") {
      scheduleEnhancer();
    } else {
      window.addEventListener("load", scheduleEnhancer, { once: true });
    }

    return () => {
      window.removeEventListener("load", scheduleEnhancer);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      observer?.disconnect();
      document.querySelectorAll<HTMLDivElement>("[data-table-search='true']").forEach(
        (container) => container.remove(),
      );
    };
  }, []);

  return null;
}
