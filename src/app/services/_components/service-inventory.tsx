import { CloudErrorBanner } from "@/components/cloud-error";
import { Plus, type LucideIcon } from "lucide-react";

import { DisabledCloudButton, RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsolePageHeader,
  ConsoleTablePanel,
  MetricCard,
  StatusBadge,
  type StatusTone,
  DataFreshnessText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
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
  tone?: StatusTone;
}) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}

const inventoryGoodStatuses = new Set([
  "200",
  "5",
  "active",
  "available",
  "blue",
  "completed",
  "finished",
  "inservice",
  "migrate_success",
  "normal",
  "online",
  "protected",
  "running",
  "success",
  "succeeded",
]);

const inventoryBadStatuses = new Set([
  "300",
  "303",
  "4",
  "abnormal",
  "abort",
  "canceled",
  "create_failed",
  "creation failed",
  "deletion failed",
  "deleted",
  "down",
  "error",
  "failed",
  "fault",
  "faulty",
  "freezed",
  "frozen",
  "migrate_fail",
  "red",
  "start_failed",
  "terminated",
  "timeout",
]);

const inventoryWarnStatuses = new Set([
  "1",
  "2",
  "3",
  "7",
  "100",
  "500",
  "910",
  "920",
  "aborting",
  "attaching",
  "build",
  "building",
  "creating",
  "inactive",
  "modifying",
  "migrating",
  "paused",
  "pausing",
  "pending",
  "pending_create",
  "pending_update",
  "ready",
  "rebooting",
  "reprotecting",
  "restarting",
  "scaling",
  "scaling-in",
  "scaling-out",
  "snapshooting",
  "snapshotting",
  "starting",
  "stoping",
  "stopped",
  "stopping",
  "syncing",
  "terminating",
  "upgrading",
  "suspend",
  "waiting",
]);

export function inventoryStatusTone(status: string): StatusTone {
  const normalized = status.toLowerCase();

  if (inventoryGoodStatuses.has(normalized)) {
    return "good";
  }

  if (inventoryBadStatuses.has(normalized)) {
    return "bad";
  }

  if (inventoryWarnStatuses.has(normalized)) {
    return "warn";
  }

  return "neutral";
}

export function ServiceInventoryPage<T>({
  actionLabel,
  actionTitle,
  active,
  backHref,
  backLabel,
  columns,
  children,
  rowKey,
  description,
  empty,
  icon: Icon,
  result,
  rows,
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
  rowKey?: (item: T) => string;
  description: string;
  empty: string;
  icon: LucideIcon;
  result: Pick<CloudResult<unknown>, "error" | "isCached" | "isRefreshing" | "updatedAt">;
  rows: T[];
  stats: Array<{ label: string; value: number | string; tone?: StatusTone }>;
  tableTitle: string;
  title: string;
  tone?: "blue" | "green" | "red";
}) {
  const pageToneClasses = {
    blue: "bg-[#eef4ff] text-[#2563eb]",
    green: "bg-[#e9f8f1] text-[#15803d]",
    red: "bg-[#fff1f2] text-[#b42318]",
  };
  const statToneClasses: Record<StatusTone, string> = {
    bad: "bg-[#fff1f2] text-[#b42318]",
    good: "bg-[#f0fdf4] text-[#166534]",
    neutral: "bg-[#f8fafc] text-[#475467]",
    warn: "bg-[#fffbeb] text-[#92400e]",
  };

  return (
    <ConsoleShell active={active}>
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            {actionLabel ? <DisabledCloudButton title={actionTitle ?? "This page is read-only."}>
              <Plus className="size-4" />
              {actionLabel}
            </DisabledCloudButton> : null}
            <RefreshButton />
            </>
          }
          backHref={backHref}
          backLabel={backLabel}
          description={description}
          icon={Icon}
          iconClassName={pageToneClasses[tone]}
          title={title}
        />

        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        {children}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <MetricCard
              icon={Icon}
              iconClassName={stat.tone ? statToneClasses[stat.tone] : pageToneClasses[tone]}
              key={stat.label}
              label={stat.label}
              value={result.error && !result.isCached ? "—" : stat.value}
              variant="compact"
            />
          ))}
        </section>

        <ConsoleTablePanel
          columns={columns.map((column) => ({ header: column.header }))}
          description={
            result.error && !result.isCached ? "Complete data could not be retrieved." : <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          emptyState={<p className="text-lg font-black">{result.error ? "Data unavailable. Try refreshing." : empty}</p>}
          minWidthClassName="min-w-[980px]"
          rows={rows.map((row, rowIndex) => ({
            cells: columns.map((column) => column.render(row)),
            key: rowKey ? rowKey(row) : String(rowIndex),
          }))}
          title={tableTitle}
        />
      </ConsoleMain>
    </ConsoleShell>
  );
}

export function goodWhen(value: boolean) {
  return value ? "good" : "warn";
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
