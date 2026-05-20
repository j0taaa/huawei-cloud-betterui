import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";

export type ReadonlyTableRow = {
  cells: Array<React.ReactNode>;
  id: string;
};

export type StatusCount = {
  label: string;
  tone?: "bad" | "good" | "neutral" | "warn";
  value: number | string;
};

const statusToneClass = {
  bad: "border-[#fecdd3] bg-[#fff1f2] text-[#b42318]",
  good: "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
  neutral: "border-[#d9e0eb] bg-white text-[#344054]",
  warn: "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]",
};

export function valueOrDash(value: unknown) {
  if (typeof value === "string") {
    return value.trim() || "-";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return "-";
}

export function joinValues(values: unknown[] | undefined) {
  if (!values?.length) {
    return "-";
  }

  return values.map(valueOrDash).filter((value) => value !== "-").join(", ") || "-";
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: StatusCount["tone"];
}) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-black ${statusToneClass[tone ?? "neutral"]}`}
    >
      {children}
    </span>
  );
}

export function ResourceLink({
  children,
  href,
}: {
  children: React.ReactNode;
  href?: string;
}) {
  if (!href) {
    return <span className="font-black">{children}</span>;
  }

  return (
    <Link className="font-black text-[#2563eb] hover:underline" href={href}>
      {children}
    </Link>
  );
}

export async function ReadonlyNetworkingPage({
  actionLabel,
  actionTitle,
  children,
  description,
  error,
  icon: Icon,
  isRefreshing,
  title,
}: {
  actionLabel: string;
  actionTitle: string;
  children: React.ReactNode;
  description: string;
  error: string | null;
  icon: LucideIcon;
  isRefreshing: boolean;
  title: string;
}) {
  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
              href="/services/networking"
            >
              <ArrowLeft className="size-4" />
              Back to networking
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Icon className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">{title}</h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  {description}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title={actionTitle}>
              <Plus className="size-4" />
              {actionLabel}
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {error}
          </section>
        ) : null}

        {children}
      </main>
    </ConsoleShell>
  );
}

export function StatusSummary({ items }: { items: StatusCount[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          className={`rounded-lg border px-4 py-3 ${statusToneClass[item.tone ?? "neutral"]}`}
          key={item.label}
        >
          <p className="text-xs font-black uppercase">{item.label}</p>
          <p className="mt-1 text-2xl font-black">{item.value}</p>
        </div>
      ))}
    </section>
  );
}

export function OperationalTable({
  columns,
  empty,
  isCached,
  rows,
  title,
  updatedAt,
}: {
  columns: string[];
  empty: string;
  isCached: boolean;
  rows: ReadonlyTableRow[];
  title: string;
  updatedAt: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
      <div className="border-b border-[#e4e9f2] p-5">
        <h2 className="text-lg font-black">{title}</h2>
        <p className="mt-1 text-sm font-medium text-[#667085]">
          Showing {isCached ? "cached" : "fresh"} data from{" "}
          <LocalDateTime value={updatedAt} />.
        </p>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
              <tr>
                {columns.map((column) => (
                  <th className="px-5 py-3" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {rows.map((row) => (
                <tr className="align-top" key={row.id}>
                  {row.cells.map((cell, index) => (
                    <td
                      className="max-w-[280px] px-5 py-4 font-semibold text-[#344054]"
                      key={`${row.id}-${index}`}
                    >
                      {cell}
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
