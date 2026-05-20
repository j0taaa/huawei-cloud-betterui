import Link from "next/link";
import { ArrowLeft, RefreshCw, type LucideIcon } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import type { CloudResult } from "@/lib/huawei-cloud";

type GovernanceShellProps = {
  active: "Monitoring" | "Security";
  backHref: string;
  backLabel: string;
  children: React.ReactNode;
  description: string;
  icon: LucideIcon;
  result: Pick<CloudResult<unknown>, "error" | "isRefreshing">;
  title: string;
  tone: "blue" | "green" | "red";
};

const toneClasses = {
  blue: "bg-[#eaf2ff] text-[#2563eb]",
  green: "bg-[#e9f8f1] text-[#15803d]",
  red: "bg-[#fff1f2] text-[#b42318]",
};

export function GovernanceShell({
  active,
  backHref,
  backLabel,
  children,
  description,
  icon: Icon,
  result,
  title,
  tone,
}: GovernanceShellProps) {
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
            <div className="flex flex-wrap items-center gap-3">
              <div className={`grid size-12 place-items-center rounded-xl ${toneClasses[tone]}`}>
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
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        {children}
      </main>
    </ConsoleShell>
  );
}

export function DataFreshness({
  count,
  isCached,
  label,
  updatedAt,
}: {
  count: number;
  isCached: boolean;
  label: string;
  updatedAt: string;
}) {
  return (
    <p className="mt-1 text-sm font-medium text-[#667085]">
      {count} {label} · Showing {isCached ? "cached" : "fresh"} data from{" "}
      <LocalDateTime value={updatedAt} />.
    </p>
  );
}

export function EmptyState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div>
        <RefreshCw className="mx-auto size-10 text-[#98a2b3]" />
        <p className="mt-4 text-lg font-black">{title}</p>
        <p className="mt-2 max-w-xl text-sm font-semibold text-[#667085]">
          {description}
        </p>
      </div>
    </div>
  );
}

export function StatusPill({
  children,
  intent,
}: {
  children: React.ReactNode;
  intent: "good" | "muted" | "warn" | "bad" | "info";
}) {
  const classes = {
    bad: "bg-[#fff1f2] text-[#b42318]",
    good: "bg-[#e9f8f1] text-[#15803d]",
    info: "bg-[#eef4ff] text-[#2563eb]",
    muted: "bg-[#f2f4f7] text-[#667085]",
    warn: "bg-[#fff7ed] text-[#c2410c]",
  };

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${classes[intent]}`}>
      {children}
    </span>
  );
}

export function StatStrip({
  items,
}: {
  items: Array<{ label: string; value: number | string; tone?: "bad" | "good" | "info" | "warn" }>;
}) {
  const toneText = {
    bad: "text-[#b42318]",
    good: "text-[#15803d]",
    info: "text-[#2563eb]",
    warn: "text-[#c2410c]",
  };

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          className="rounded-xl border border-[#e4e9f2] bg-white p-4 shadow-[0_12px_36px_rgba(16,24,40,0.04)]"
          key={item.label}
        >
          <p className="text-xs font-black uppercase text-[#667085]">{item.label}</p>
          <p className={`mt-2 text-2xl font-black ${item.tone ? toneText[item.tone] : ""}`}>
            {item.value}
          </p>
        </div>
      ))}
    </section>
  );
}

export function formatDateTime(value: unknown) {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "";
}

export function pickString(
  item: Record<string, unknown>,
  keys: string[],
  fallback = "-",
) {
  for (const key of keys) {
    const value = item[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return fallback;
}

export function pickBoolean(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];

    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

export function pickNumber(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];

    if (typeof value === "number") {
      return value;
    }
  }

  return null;
}
