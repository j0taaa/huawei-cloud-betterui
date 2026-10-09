import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsolePageHeader,
  ConsoleResourceLink,
  ConsoleTablePanel,
  MetricCard,
  StatusBadge as ConsoleStatusBadge,
  type StatusTone,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";

export type ReadonlyTableRow = {
  cells: Array<React.ReactNode>;
  id: string;
};

export type StatusCount = {
  label: string;
  tone?: StatusTone;
  value: number | string;
};

const statusMetricClasses: Record<StatusTone, string> = {
  bad: "bg-[#fff1f2] text-[#b42318]",
  good: "bg-[#f0fdf4] text-[#166534]",
  neutral: "bg-[#f8fafc] text-[#475467]",
  warn: "bg-[#fffbeb] text-[#92400e]",
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
  return <ConsoleStatusBadge className="h-7 items-center" tone={tone}>{children}</ConsoleStatusBadge>;
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

  return <ConsoleResourceLink href={href}>{children}</ConsoleResourceLink>;
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
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title={actionTitle}>
              <Plus className="size-4" />
              {actionLabel}
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/services/networking"
          backLabel="Back to networking"
          description={description}
          icon={Icon}
          title={title}
        />

        {error ? <ConsoleCallout>{error}</ConsoleCallout> : null}

        {children}
      </ConsoleMain>
    </ConsoleShell>
  );
}

export function StatusSummary({ items }: { items: StatusCount[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <MetricCard
          iconClassName={statusMetricClasses[item.tone ?? "neutral"]}
          key={item.label}
          label={item.label}
          value={item.value}
          valueClassName={statusMetricClasses[item.tone ?? "neutral"]}
          variant="compact"
        />
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
    <ConsoleTablePanel
      columns={columns.map((column) => ({ header: column }))}
      description={
        <>
          Showing {isCached ? "cached" : "fresh"} data from{" "}
          <LocalDateTime value={updatedAt} />.
        </>
      }
      emptyState={<p className="text-lg font-black">{empty}</p>}
      minWidthClassName="min-w-[980px]"
      rows={rows.map((row) => ({
        cells: row.cells,
        key: row.id,
      }))}
      title={title}
    />
  );
}
