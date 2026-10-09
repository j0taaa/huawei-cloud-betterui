import { RefreshCw, type LucideIcon } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsoleEmptyPanelBody,
  ConsolePageHeader,
  MetricCard,
  StatusBadge,
  type StatusTone,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import type { CloudResult } from "@/lib/huawei-cloud";

type GovernanceShellProps = {
  actions?: React.ReactNode;
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

const statToneClasses = {
  bad: "text-[#b42318]",
  good: "text-[#15803d]",
  info: "text-[#2563eb]",
  warn: "text-[#c2410c]",
};

const statusIntentMap: Record<"good" | "muted" | "warn" | "bad" | "info", StatusTone> = {
  bad: "bad",
  good: "good",
  info: "neutral",
  muted: "neutral",
  warn: "warn",
};

export function GovernanceShell({
  actions,
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
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>{actions}<RefreshButton /></>
          }
          backHref={backHref}
          backLabel={backLabel}
          description={description}
          icon={Icon}
          iconClassName={toneClasses[tone]}
          title={title}
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        {children}
      </ConsoleMain>
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
    <ConsoleEmptyPanelBody icon={RefreshCw} title={title}>
      {description}
    </ConsoleEmptyPanelBody>
  );
}

export function StatusPill({
  children,
  intent,
}: {
  children: React.ReactNode;
  intent: "good" | "muted" | "warn" | "bad" | "info";
}) {
  return <StatusBadge tone={statusIntentMap[intent]}>{children}</StatusBadge>;
}

export function StatStrip({
  items,
}: {
  items: Array<{ label: string; value: number | string; tone?: "bad" | "good" | "info" | "warn" }>;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          valueClassName={item.tone ? statToneClasses[item.tone] : undefined}
          variant="compact"
        />
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
