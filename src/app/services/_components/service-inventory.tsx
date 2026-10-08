import Link from "next/link";
import { ArrowLeft, Plus, type LucideIcon } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { CloudErrorBanner } from "@/components/cloud-error";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import type { CloudResult } from "@/lib/huawei-cloud";
import type { ServiceCategory } from "@/lib/service-catalog";

export type InventoryColumn<T> = {
  header: string;
  render: (item: T) => React.ReactNode;
};

export function InventoryStatus({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "bad" | "good" | "neutral" | "warn";
}) {
  const classes = {
    bad: "border-[#fecdd3] bg-[#fff1f2] text-[#b42318]",
    good: "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
    neutral: "border-[#d9e0eb] bg-white text-[#344054]",
    warn: "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${classes[tone]}`}
    >
      {children}
    </span>
  );
}

export function ServiceInventoryPage<T>({
  actionLabel,
  actionTitle,
  active,
  backHref,
  backLabel,
  columns,
  children,
  description,
  empty,
  icon: Icon,
  result,
  rows,
  rowKey,
  stats,
  tableTitle,
  title,
  tone = "blue",
}: {
  actionLabel?: string;
  actionTitle?: string;
  active: ServiceCategory;
  backHref: string;
  backLabel: string;
  columns: InventoryColumn<T>[];
  children?: React.ReactNode;
  description: string;
  empty: string;
  icon: LucideIcon;
  result: Pick<
    CloudResult<unknown>,
    "error" | "isCached" | "isRefreshing" | "updatedAt"
  >;
  rows: T[];
  rowKey?: (item: T) => string;
  stats: Array<{
    label: string;
    value: number | string;
    tone?: "bad" | "good" | "neutral" | "warn";
  }>;
  tableTitle: string;
  title: string;
  tone?: "blue" | "green" | "red";
}) {
  const toneClasses = {
    blue: "bg-[#eef4ff] text-[#2563eb]",
    green: "bg-[#e9f8f1] text-[#15803d]",
    red: "bg-[#fff1f2] text-[#b42318]",
  };

  return (
    <ConsoleShell active={active}>
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
              href={backHref}
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Link>
            <div className="flex items-center gap-3">
              <div
                className={`grid size-12 place-items-center rounded-xl ${toneClasses[tone]}`}
              >
                <Icon className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">{title}</h1>
                <p className="mt-1 max-w-3xl text-sm font-medium text-[#667085]">
                  {description}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {actionLabel ? (
              <DisabledCloudButton
                title={actionTitle ?? "This page is read-only."}
              >
                <Plus className="size-4" />
                {actionLabel}
              </DisabledCloudButton>
            ) : null}
            <RefreshButton />
          </div>
        </div>

        <CloudErrorBanner error={result.error} isCached={result.isCached} />

        {children}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div
              className="rounded-xl border border-[#e4e9f2] bg-white p-4 shadow-[0_12px_36px_rgba(16,24,40,0.04)]"
              key={stat.label}
            >
              <p className="text-xs font-black uppercase text-[#667085]">
                {stat.label}
              </p>
              <p className="mt-2 text-2xl font-black">
                {result.error && !result.isCached ? "—" : stat.value}
              </p>
              {stat.tone ? (
                <div className="mt-2">
                  <InventoryStatus tone={stat.tone}>
                    {stat.tone}
                  </InventoryStatus>
                </div>
              ) : null}
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="p-5">
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {result.error && !result.isCached ? (
                "Complete data could not be retrieved."
              ) : (
                <>
                  Showing {result.isCached ? "cached" : "fresh"} data from{" "}
                  <LocalDateTime value={result.updatedAt} />.
                </>
              )}
            </p>
          </div>
          <InventoryTable
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            title={tableTitle}
            empty={result.error ? "Data unavailable. Try refreshing." : empty}
          />
        </section>
      </main>
    </ConsoleShell>
  );
}

export function InventoryTable<T>({
  columns,
  rows,
  title,
  empty,
  rowKey,
}: {
  columns: InventoryColumn<T>[];
  rows: T[];
  title: string;
  empty: string;
  rowKey?: (item: T) => string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white">
      <h2 className="border-b border-[#e4e9f2] p-5 text-lg font-black">
        {title}
      </h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
              <tr>
                {columns.map((column) => (
                  <th className="px-5 py-3" key={column.header}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {rows.map((row, rowIndex) => (
                <tr className="align-top" key={rowKey ? rowKey(row) : rowIndex}>
                  {columns.map((column) => (
                    <td
                      className="max-w-[300px] px-5 py-4 font-semibold text-[#344054]"
                      key={column.header}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid place-items-center px-6 py-16 text-center">
          <p className="text-lg font-black">{empty}</p>
        </div>
      )}
    </section>
  );
}

export function ResourceFacts({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <dl className="grid gap-3 rounded-xl border border-[#e4e9f2] bg-white p-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(({ label, value }) => (
        <div key={label}>
          <dt className="text-xs font-black uppercase text-[#667085]">
            {label}
          </dt>
          <dd className="mt-2 break-words text-sm font-semibold">
            {value == null || value === "" ? "—" : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function goodWhen(value: boolean) {
  return value ? "good" : "warn";
}
