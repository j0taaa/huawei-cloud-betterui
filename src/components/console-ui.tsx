import Link from "next/link";
import { ArrowLeft, Copy, X, type LucideIcon } from "lucide-react";
import { type HTMLAttributes, type ReactNode } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import { cn } from "@/lib/utils";

export * from "@/components/console-ui/code-display";
export * from "@/components/console-ui/form-controls";
export * from "@/components/console-ui/interactions";
export * from "@/components/console-ui/loading";

type ConsolePageHeaderProps = {
  actions?: ReactNode;
  backHref: string;
  backLabel: string;
  description?: ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
};

export function ConsoleMain({
  background = "default",
  children,
  className,
}: {
  background?: "default" | "muted";
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "grid gap-6 p-4 lg:p-8",
        background === "muted" ? "bg-[#f8fafc]" : null,
        className,
      )}
    >
      {children}
    </main>
  );
}

type ConsoleIconTileSize = "lg" | "md" | "sm";

const consoleIconTileSizeClasses: Record<ConsoleIconTileSize, string> = {
  lg: "size-12 rounded-xl",
  md: "size-10 rounded-lg",
  sm: "size-9 rounded-lg",
};

export function ConsoleIconTile({
  children,
  className,
  size = "lg",
}: {
  children: ReactNode;
  className?: string;
  size?: ConsoleIconTileSize;
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center bg-[#eef4ff] text-[#2563eb]",
        consoleIconTileSizeClasses[size],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ConsoleBackLink({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <Link
      className={cn(
        "inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]",
        className,
      )}
      href={href}
    >
      <ArrowLeft className="size-4" />
      {children}
    </Link>
  );
}

export function ConsoleResourceLink({
  children,
  className,
  href,
  underline = true,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  underline?: boolean;
}) {
  return (
    <Link
      className={cn(
        "font-black text-[#2563eb] dark:text-[#93c5fd]",
        underline ? "hover:underline" : null,
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

export function ConsolePageHeader({
  actions,
  backHref,
  backLabel,
  description,
  icon: Icon,
  iconClassName,
  title,
}: ConsolePageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <ConsoleBackLink className="mb-4" href={backHref}>
          {backLabel}
        </ConsoleBackLink>
        <div className="flex items-center gap-3">
          <ConsoleIconTile className={iconClassName}>
            <Icon className="size-6" />
          </ConsoleIconTile>
          <div>
            <h1 className="text-3xl font-black tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm font-medium text-[#667085]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <ConsoleActionGroup>{actions}</ConsoleActionGroup> : null}
    </div>
  );
}

type ResourceDetailHeroProps = {
  actions?: ReactNode;
  backHref: string;
  backLabel: string;
  description?: ReactNode;
  eyebrow: ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  id?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
};

type ConsoleDetailHeaderProps = {
  actions?: ReactNode;
  backHref: string;
  backLabel: ReactNode;
  description?: ReactNode;
  eyebrow: ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  id?: ReactNode;
  title: ReactNode;
  titleClassName?: string;
};

export function ConsoleDetailHeader({
  actions,
  backHref,
  backLabel,
  description,
  eyebrow,
  icon: Icon,
  iconClassName,
  id,
  title,
  titleClassName,
}: ConsoleDetailHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <ConsoleBackLink className="mb-4" href={backHref}>
          {backLabel}
        </ConsoleBackLink>
        <div className="flex items-start gap-4">
          <ConsoleIconTile className={iconClassName}>
            <Icon className="size-6" />
          </ConsoleIconTile>
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">
              {eyebrow}
            </p>
            <h1
              className={cn(
                "mt-1 break-words text-3xl font-black tracking-tight",
                titleClassName,
              )}
            >
              {title}
            </h1>
            {id ? <div className="mt-2">{id}</div> : null}
            {description ? (
              <p className="mt-2 text-xs font-bold text-[#98a2b3]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <ConsoleActionGroup>{actions}</ConsoleActionGroup> : null}
    </div>
  );
}

export function ResourceDetailHero({
  actions,
  backHref,
  backLabel,
  description,
  eyebrow,
  icon: Icon,
  iconClassName,
  id,
  status,
  title,
}: ResourceDetailHeroProps) {
  return (
    <>
      <ConsoleBackLink href={backHref}>
        {backLabel}
      </ConsoleBackLink>
      <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-center gap-4">
            <ConsoleIconTile className={iconClassName}>
              <Icon className="size-6" />
            </ConsoleIconTile>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">
                {eyebrow}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-black tracking-tight">{title}</h1>
                {status}
              </div>
              {id ? (
                <p className="mt-1 break-all text-sm font-semibold text-[#667085]">
                  {id}
                </p>
              ) : null}
              {description ? (
                <p className="mt-1 text-xs font-bold text-[#98a2b3]">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? <ConsoleActionGroup>{actions}</ConsoleActionGroup> : null}
        </div>
      </section>
    </>
  );
}

type MetricCardProps = {
  className?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  label: ReactNode;
  valueClassName?: string;
  value: ReactNode;
  variant?: "compact" | "spacious";
};

export type ConsoleSummaryTileTone =
  | "blue"
  | "cyan"
  | "emerald"
  | "fuchsia"
  | "indigo"
  | "orange"
  | "violet";

const consoleSummaryTileTones: Record<
  ConsoleSummaryTileTone,
  { border: string; icon: string; tile: string }
> = {
  blue: {
    border: "border-[#bfdbfe] dark:border-[#2563eb]/40",
    icon: "bg-[#dbeafe] text-[#2563eb] dark:bg-[#1e3a8a]/50 dark:text-[#93c5fd]",
    tile: "bg-[#eff6ff] dark:bg-[#0b1730]",
  },
  cyan: {
    border: "border-[#a5f3fc] dark:border-[#0891b2]/40",
    icon: "bg-[#cffafe] text-[#0891b2] dark:bg-[#164e63]/50 dark:text-[#67e8f9]",
    tile: "bg-[#ecfeff] dark:bg-[#082f49]",
  },
  emerald: {
    border: "border-[#bbf7d0] dark:border-[#16a34a]/40",
    icon: "bg-[#dcfce7] text-[#16a34a] dark:bg-[#14532d]/50 dark:text-[#86efac]",
    tile: "bg-[#f0fdf4] dark:bg-[#052e16]",
  },
  fuchsia: {
    border: "border-[#f5d0fe] dark:border-[#c026d3]/40",
    icon: "bg-[#fae8ff] text-[#c026d3] dark:bg-[#581c87]/50 dark:text-[#f0abfc]",
    tile: "bg-[#fdf4ff] dark:bg-[#3b0764]",
  },
  indigo: {
    border: "border-[#c7d2fe] dark:border-[#4f46e5]/40",
    icon: "bg-[#e0e7ff] text-[#4f46e5] dark:bg-[#312e81]/50 dark:text-[#a5b4fc]",
    tile: "bg-[#eef2ff] dark:bg-[#1e1b4b]",
  },
  orange: {
    border: "border-[#fed7aa] dark:border-[#ea580c]/40",
    icon: "bg-[#ffedd5] text-[#ea580c] dark:bg-[#7c2d12]/50 dark:text-[#fdba74]",
    tile: "bg-[#fff7ed] dark:bg-[#431407]",
  },
  violet: {
    border: "border-[#ddd6fe] dark:border-[#7c3aed]/40",
    icon: "bg-[#ede9fe] text-[#7c3aed] dark:bg-[#4c1d95]/50 dark:text-[#c4b5fd]",
    tile: "bg-[#f5f3ff] dark:bg-[#2e1065]",
  },
};

export function ConsoleSummaryTile({
  className,
  icon,
  label,
  tone = "blue",
  value,
}: {
  className?: string;
  icon: ReactNode;
  label: ReactNode;
  tone?: ConsoleSummaryTileTone;
  value: ReactNode;
}) {
  const classes = consoleSummaryTileTones[tone];

  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2 shadow-sm",
        classes.border,
        classes.tile,
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", classes.icon)}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#667085] dark:text-[#98a2b3]">
            {label}
          </p>
          <div className="mt-0.5 truncate text-sm font-black text-[#101828] dark:text-white">
            {value || "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConsoleSummaryTileGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-3 rounded-2xl border border-[#d9e0eb] bg-[#f8fafc] p-4 dark:border-white/10 dark:bg-[#07111f]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function ConsoleCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)] dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      {children}
    </article>
  );
}

export function ConsoleFormLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-6 lg:grid-cols-[320px_1fr]", className)}>
      {children}
    </section>
  );
}

export function ConsoleFormSummaryCard({
  children,
  description,
  icon,
  iconClassName,
  title,
}: {
  children?: ReactNode;
  description: ReactNode;
  icon: ReactNode;
  iconClassName?: string;
  title: ReactNode;
}) {
  return (
    <ConsolePanel className="p-5">
      <ConsoleIconTile className={iconClassName}>{icon}</ConsoleIconTile>
      <h2 className="mt-4 text-lg font-black text-[#101828] dark:text-white">{title}</h2>
      <p className="mt-2 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
        {description}
      </p>
      {children}
    </ConsolePanel>
  );
}

export function ConsoleFormActions({
  actions,
  children,
  className,
  align = "between",
}: {
  actions: ReactNode;
  align?: "between" | "end";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-[#e4e9f2] p-5 dark:border-white/10 md:flex-row md:items-center",
        align === "between" ? "md:justify-between" : "justify-end",
        className,
      )}
    >
      {children ? <div className="min-w-0 flex-1">{children}</div> : null}
      <div className="flex shrink-0 flex-wrap justify-end gap-3">{actions}</div>
    </div>
  );
}

export function ConsoleSidecarLayout({
  children,
  className,
  contentClassName,
  contentProps,
  sidebar,
  sidebarClassName,
  columnsClassName = "lg:grid-cols-[240px_minmax(0,1fr)]",
}: {
  children: ReactNode;
  className?: string;
  columnsClassName?: string;
  contentClassName?: string;
  contentProps?: HTMLAttributes<HTMLDivElement>;
  sidebar: ReactNode;
  sidebarClassName?: string;
}) {
  const { className: contentPropsClassName, ...restContentProps } = contentProps ?? {};

  return (
    <div
      className={cn(
        "grid border-t border-[#eef2f7] dark:border-white/10",
        columnsClassName,
        className,
      )}
    >
      <aside
        className={cn(
          "border-b border-[#eef2f7] bg-[#f8fafc] p-3 dark:border-white/10 dark:bg-[#111827] lg:border-b-0 lg:border-r",
          sidebarClassName,
        )}
      >
        {sidebar}
      </aside>
      <div
        {...restContentProps}
        className={cn("min-w-0 p-5", contentClassName, contentPropsClassName)}
      >
        {children}
      </div>
    </div>
  );
}

export function ConsoleFieldList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-[#e4e9f2] rounded-xl border border-[#e4e9f2] bg-[#f8fafc] px-4 dark:divide-white/10 dark:border-white/10 dark:bg-white/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ConsoleStatCard({
  description,
  icon: Icon,
  iconClassName,
  status,
  title,
  value,
}: {
  description?: ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  status?: ReactNode;
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <ConsoleCard>
      <div className="flex items-center justify-between gap-3">
        <ConsoleIconTile
          className={cn("rounded-full bg-[#f7f9fc] text-[#2563eb]", iconClassName)}
        >
          <Icon className="size-6" />
        </ConsoleIconTile>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      <p className="mt-5 text-sm font-bold text-[#344054] dark:text-[#cbd5e1]">{title}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-[#101828] dark:text-white">
        {value}
      </p>
      {description ? (
        <p className="mt-3 text-sm font-medium text-[#667085] dark:text-[#98a2b3]">
          {description}
        </p>
      ) : null}
    </ConsoleCard>
  );
}

export function ConsoleStatCardGrid({
  children,
  className,
  columns = 4,
}: {
  children: ReactNode;
  className?: string;
  columns?: 3 | 4 | 5;
}) {
  const columnClassName = {
    3: "lg:grid-cols-3",
    4: "md:grid-cols-2 2xl:grid-cols-4",
    5: "md:grid-cols-2 xl:grid-cols-5",
  }[columns];

  return (
    <section className={cn("grid gap-4", columnClassName, className)}>
      {children}
    </section>
  );
}

export function MetricCard({
  className,
  description,
  icon: Icon,
  iconClassName,
  label,
  valueClassName,
  value,
  variant = "spacious",
}: MetricCardProps) {
  return (
    <article
      className={cn(
        "rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)] dark:border-white/10 dark:bg-[#0b1220]",
        variant === "compact" ? "p-4" : "p-5",
        className,
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          variant === "compact" ? "items-center" : "items-center justify-between",
        )}
      >
        {variant === "compact" ? (
          <>
            {Icon ? (
              <ConsoleIconTile className={iconClassName} size="md">
                <Icon className="size-5" />
              </ConsoleIconTile>
            ) : null}
            <div>
              <p className="text-xs font-black uppercase text-[#667085]">{label}</p>
              <p className={cn("mt-1 text-2xl font-black", valueClassName)}>{value}</p>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-[#667085]">{label}</p>
            {Icon ? (
              <ConsoleIconTile className={iconClassName} size="sm">
                <Icon className="size-4" />
              </ConsoleIconTile>
            ) : null}
          </>
        )}
      </div>
      {variant === "spacious" ? (
        <p className={cn("mt-3 text-2xl font-black", valueClassName)}>{value}</p>
      ) : null}
      {description ? (
        <p className="mt-1 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
          {description}
        </p>
      ) : null}
    </article>
  );
}

export function ConsoleNoticeCard({
  children,
  className,
  icon,
  title,
  tone = "good",
}: {
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  title: ReactNode;
  tone?: "good" | "info" | "warn";
}) {
  const toneClassName = {
    good: "text-[#16a34a] dark:text-[#86efac]",
    info: "text-[#2563eb] dark:text-[#93c5fd]",
    warn: "text-[#d97706] dark:text-[#fdba74]",
  }[tone];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4 dark:bg-white/5",
        className,
      )}
    >
      {icon ? <span className={cn("shrink-0", toneClassName)}>{icon}</span> : null}
      <div>
        <p className="text-sm font-black text-[#101828] dark:text-white">{title}</p>
        {children ? (
          <p className="mt-1 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
            {children}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ConsoleActivityList({
  className,
  items,
}: {
  className?: string;
  items: Array<{
    detail?: ReactNode;
    icon?: ReactNode;
    key?: string;
    meta?: ReactNode;
    title: ReactNode;
  }>;
}) {
  return (
    <div className={cn("mt-5 grid gap-4", className)}>
      {items.map((item, index) => (
        <div className="flex gap-3" key={item.key ?? index}>
          {item.icon ? <span className="mt-0.5 shrink-0">{item.icon}</span> : null}
          <div>
            <p className="text-sm font-bold text-[#101828] dark:text-white">{item.title}</p>
            {item.detail || item.meta ? (
              <p className="mt-1 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
                {item.detail}
                {item.detail && item.meta ? " · " : null}
                {item.meta}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConsoleProgressSummary({
  className,
  label,
  percent,
  value,
}: {
  className?: string;
  label: ReactNode;
  percent: number;
  value: ReactNode;
}) {
  const normalizedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className={cn("mt-5 rounded-lg bg-[#fbfcfe] p-4 dark:bg-white/5", className)}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <span className="text-sm font-bold text-[#667085] dark:text-[#98a2b3]">
          {label}
        </span>
        <span className="text-2xl font-black text-[#101828] dark:text-white">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e4e9f2] dark:bg-white/10">
        <div
          className="h-full bg-[#2563eb] dark:bg-[#60a5fa]"
          style={{ width: `${normalizedPercent}%` }}
        />
      </div>
    </div>
  );
}

export function ConsoleInlineRowList({
  className,
  emptyState,
  items,
}: {
  className?: string;
  emptyState?: ReactNode;
  items: Array<{ key?: string; label: ReactNode; value: ReactNode }>;
}) {
  if (!items.length) {
    return emptyState ? (
      <p className={cn("text-sm font-semibold text-[#667085] dark:text-[#98a2b3]", className)}>
        {emptyState}
      </p>
    ) : null;
  }

  return (
    <div className={cn("grid gap-3", className)}>
      {items.map((item, index) => (
        <div
          className="flex items-center justify-between gap-4 rounded-lg bg-[#f8fafc] px-3 py-2 text-sm font-bold dark:bg-white/5"
          key={item.key ?? index}
        >
          <span className="min-w-0 truncate text-[#101828] dark:text-white">{item.label}</span>
          <span className="shrink-0 text-[#2563eb] dark:text-[#93c5fd]">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function MetricGrid({
  children,
  className,
  columns = 4,
}: {
  children: ReactNode;
  className?: string;
  columns?: 3 | 4 | 5;
}) {
  const columnClassName = {
    3: "xl:grid-cols-3",
    4: "xl:grid-cols-4",
    5: "xl:grid-cols-5",
  }[columns];

  return (
    <section className={cn("grid gap-4 md:grid-cols-2", columnClassName, className)}>
      {children}
    </section>
  );
}

type AccentStatItem = {
  accentClassName?: string;
  label: ReactNode;
  value: ReactNode;
};

export function AccentStatGrid({
  className,
  columns = 3,
  items,
}: {
  className?: string;
  columns?: 2 | 3 | 4;
  items: AccentStatItem[];
}) {
  const columnClassName = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 xl:grid-cols-4",
  }[columns];

  return (
    <div className={cn("grid gap-3", columnClassName, className)}>
      {items.map((item, index) => (
        <div
          className={cn("border-l-4 pl-3", item.accentClassName ?? "border-[#2563eb]")}
          key={index}
        >
          <p className="text-2xl font-black text-[#101828] dark:text-white">{item.value}</p>
          <p className="text-xs font-bold uppercase text-[#667085] dark:text-[#98a2b3]">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ConsoleIconValueList({
  iconClassName = "text-[#2563eb] dark:text-[#93c5fd]",
  items,
}: {
  iconClassName?: string;
  items: Array<{
    icon: LucideIcon;
    label: ReactNode;
    value: ReactNode;
  }>;
}) {
  return (
    <div className="mt-5 divide-y divide-[#e4e9f2] dark:divide-white/10">
      {items.map((item, index) => {
        const Icon = item.icon;

        return (
          <div
            className="flex items-center justify-between gap-4 py-3"
            key={index}
          >
            <span className="flex items-center gap-3 text-sm font-bold text-[#475467] dark:text-[#cbd5e1]">
              <Icon className={cn("size-5", iconClassName)} />
              {item.label}
            </span>
            <span className="text-right text-sm font-black text-[#101828] dark:text-white">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ConsoleFeatureList({
  className,
  iconClassName,
  items,
}: {
  className?: string;
  iconClassName?: string;
  items: Array<{
    icon: LucideIcon;
    label: ReactNode;
  }>;
}) {
  return (
    <div className={cn("grid gap-3", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;

        return (
          <div
            className="flex items-center gap-3 rounded-xl border border-[#e4e9f2] bg-[#fbfcfe] p-4 text-sm font-bold dark:border-white/10 dark:bg-white/5"
            key={index}
          >
            <ConsoleIconTile
              className={cn(
                "size-9 rounded-lg bg-[#eef4ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]",
                iconClassName,
              )}
              size="sm"
            >
              <Icon className="size-4" />
            </ConsoleIconTile>
            {item.label}
          </div>
        );
      })}
    </div>
  );
}

export function DataFreshnessText({
  isCached,
  prefix,
  updatedAt,
}: {
  isCached: boolean;
  prefix?: ReactNode;
  updatedAt: string;
}) {
  return (
    <>
      {prefix ? <>{prefix} · </> : null}
      Showing {isCached ? "cached" : "fresh"} data from{" "}
      <LocalDateTime value={updatedAt} />.
    </>
  );
}

export type FactGridItem = {
  label: ReactNode;
  value: ReactNode;
};

export function FactGrid({
  className,
  items,
}: {
  className?: string;
  items: FactGridItem[];
}) {
  return (
    <section className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
      {items.map((item, index) => (
        <article
          className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
          key={index}
        >
          <p className="text-sm font-bold text-[#667085]">{item.label}</p>
          <p className="mt-2 break-words text-lg font-black">{item.value}</p>
        </article>
      ))}
    </section>
  );
}

export function TagList({
  emptyState,
  items,
  tone = "blue",
}: {
  emptyState: ReactNode;
  items: ReactNode[];
  tone?: "blue" | "neutral";
}) {
  if (!items.length) {
    return <span className="text-sm font-semibold text-[#667085]">{emptyState}</span>;
  }

  const toneClassName =
    tone === "neutral"
      ? "bg-[#f2f4f7] text-[#344054]"
      : "bg-[#eef4ff] text-[#2563eb]";

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span className={cn("rounded-full px-3 py-1 text-xs font-black", toneClassName)} key={index}>
          {item}
        </span>
      ))}
    </div>
  );
}

type CompactInfoCardItem = {
  body: ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
};

type CompactFactItem = {
  label: ReactNode;
  value: ReactNode;
};

export function CompactFactList({
  className,
  columns,
  items,
  valueClassName,
}: {
  className?: string;
  columns?: 2 | 3;
  items: CompactFactItem[];
  valueClassName?: string;
}) {
  const columnClassName = columns === 3 ? "grid-cols-3" : columns === 2 ? "md:grid-cols-2" : null;

  return (
    <dl className={cn("grid gap-3 text-sm", columnClassName, className)}>
      {items.map((item, index) => (
        <div className="rounded-lg bg-[#f8fafc] p-3 dark:bg-white/5" key={index}>
          <dt className="text-xs font-black uppercase text-[#667085] dark:text-[#98a2b3]">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-1 break-words font-black text-[#101828] dark:text-white",
              valueClassName,
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CompactInfoCardGrid({
  className,
  columns = 2,
  items,
}: {
  className?: string;
  columns?: 2 | 3;
  items: CompactInfoCardItem[];
}) {
  const columnClassName = columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2";

  return (
    <section className={cn("grid gap-3", columnClassName, className)}>
      {items.map((item, index) => {
        const Icon = item.icon;

        return (
          <article
            className="rounded-lg border border-[#e4e9f2] p-3 dark:border-white/10"
            key={index}
          >
            <p className="flex items-center gap-2 text-sm font-black text-[#101828] dark:text-white">
              {Icon ? (
                <Icon
                  className={cn(
                    "size-4 shrink-0 text-[#667085] dark:text-[#98a2b3]",
                    item.iconClassName,
                  )}
                />
              ) : null}
              {item.title}
            </p>
            <div className="mt-2 break-words text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
              {item.body}
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function ConsoleSectionHeader({
  actions,
  className,
  title,
}: {
  actions?: ReactNode;
  className?: string;
  title: ReactNode;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h3 className="font-black text-[#101828] dark:text-white">{title}</h3>
      {actions ? (
        <div className="shrink-0 text-xs font-black text-[#667085] dark:text-[#98a2b3]">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export type FieldGridItem = {
  label: ReactNode;
  value: ReactNode;
};

type ConsoleDescriptionListTone = "danger" | "good" | "neutral" | "purple";

const consoleDescriptionListToneClasses: Record<ConsoleDescriptionListTone, string> = {
  danger: "bg-[#fff8f7] dark:bg-[#450a0a]/30",
  good: "bg-[#f0fdf4] dark:bg-[#052e16]/40",
  neutral: "bg-[#f8fafc] dark:bg-white/5",
  purple: "bg-[#f5f3ff] dark:bg-[#2e1065]/30",
};

export type ConsoleDescriptionListItem = {
  className?: string;
  label: ReactNode;
  value: ReactNode;
};

export function ConsoleDescriptionList({
  columns = 1,
  items,
  tone = "neutral",
}: {
  columns?: 1 | 2;
  items: ConsoleDescriptionListItem[];
  tone?: ConsoleDescriptionListTone;
}) {
  return (
    <dl
      className={cn(
        "grid gap-2 rounded-lg p-4 text-sm",
        columns === 2 ? "md:grid-cols-2" : null,
        consoleDescriptionListToneClasses[tone],
      )}
    >
      {items.map((item, index) => (
        <div className={item.className} key={index}>
          <dt className="font-bold text-[#667085] dark:text-[#98a2b3]">{item.label}</dt>
          <dd className="mt-1 break-words font-black text-[#101828] dark:text-white">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ConsoleKeyValueList({
  className,
  items,
  spacing = "normal",
}: {
  className?: string;
  items: ConsoleDescriptionListItem[];
  spacing?: "normal" | "tight";
}) {
  return (
    <dl className={cn("grid text-sm", spacing === "tight" ? "gap-1.5" : "gap-2", className)}>
      {items.map((item, index) => (
        <div className={cn("flex justify-between gap-4", item.className)} key={index}>
          <dt className="font-semibold text-[#667085] dark:text-[#98a2b3]">{item.label}</dt>
          <dd className="break-words text-right font-black text-[#101828] dark:text-white">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FieldGrid({ items }: { items: FieldGridItem[] }) {
  return (
    <div className="grid gap-4 p-5 md:grid-cols-2">
      {items.map((item, index) => (
        <div
          className="min-w-0 border-b border-[#eef2f7] pb-4 last:border-b-0 md:border-b-0 md:pb-0"
          key={index}
        >
          <p className="text-xs font-black uppercase text-[#98a2b3]">{item.label}</p>
          <div className="mt-2 break-words text-sm font-black text-[#101828]">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export type KeyValueGridItem = {
  key: ReactNode;
  value: ReactNode;
};

export function KeyValueGrid({
  emptyState,
  items,
}: {
  emptyState: ReactNode;
  items: KeyValueGridItem[];
}) {
  if (!items.length) {
    return <p className="p-5 text-sm font-semibold text-[#667085]">{emptyState}</p>;
  }

  return (
    <FieldGrid
      items={items.map((item) => ({
        label: item.key,
        value: item.value,
      }))}
    />
  );
}

export function StringListPanel({
  emptyState,
  items,
}: {
  emptyState: ReactNode;
  items: ReactNode[];
}) {
  if (!items.length) {
    return <p className="p-5 text-sm font-semibold text-[#667085]">{emptyState}</p>;
  }

  return (
    <div className="grid gap-2 p-5">
      {items.map((item, index) => (
        <p className="break-all text-sm font-bold text-[#101828]" key={index}>
          {item}
        </p>
      ))}
    </div>
  );
}

export function DetailItem({
  href,
  icon,
  label,
  showCopyIcon = true,
  subValue,
  value,
}: {
  href?: string;
  icon?: ReactNode;
  label: ReactNode;
  showCopyIcon?: boolean;
  subValue?: ReactNode;
  value: ReactNode;
}) {
  const valueContent = href ? (
    <Link className="text-[#2563eb] hover:underline dark:text-[#93c5fd]" href={href}>
      {value}
    </Link>
  ) : (
    value
  );

  return (
    <div className="flex gap-3">
      {icon ? (
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#eef4ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-black text-[#667085] dark:text-[#98a2b3]">{label}</p>
        <p className="mt-1 flex items-center gap-2 break-words text-sm font-black text-[#101828] dark:text-white">
          {valueContent}
          {showCopyIcon && value !== "-" ? (
            <Copy className="size-3.5 shrink-0 text-[#667085] dark:text-[#98a2b3]" />
          ) : null}
        </p>
        {subValue ? (
          <p className="mt-1 break-words text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
            {subValue}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DetailSection({
  children,
  className,
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[#e4e9f2] bg-white p-6 shadow-[0_18px_48px_rgba(16,24,40,0.07)] dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      {title || icon ? (
        <div className="mb-5 flex items-center gap-2">
          {icon ? (
            <div className="grid size-7 place-items-center rounded-lg bg-[#f4f7fb] text-[#101828] dark:bg-white/10 dark:text-white">
              {icon}
            </div>
          ) : null}
          {title ? <h2 className="text-lg font-black tracking-tight">{title}</h2> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyStatePanel({
  children,
  title,
}: {
  children: ReactNode;
  title: ReactNode;
}) {
  return (
    <ConsolePanel className="border-dashed">
      <div className="grid place-items-center px-6 py-12 text-center">
        <div>
          <h2 className="text-lg font-black tracking-tight">{title}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
            {children}
          </p>
        </div>
      </div>
    </ConsolePanel>
  );
}

export function EmptyContent({
  children,
  className,
  icon: Icon,
  iconClassName,
  title,
}: {
  children?: ReactNode;
  className?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
}) {
  return (
    <div className={className}>
      {Icon ? (
        <Icon className={cn("mx-auto mb-4 size-10 text-[#98a2b3]", iconClassName)} />
      ) : null}
      <p className={cn("font-black text-[#101828] dark:text-white", Icon ? "text-lg" : null)}>
        {title}
      </p>
      {children ? (
        <p className="mt-1 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
          {children}
        </p>
      ) : null}
    </div>
  );
}

export function ConsoleEmptyPanelBody({
  children,
  className,
  icon,
  title,
}: {
  children?: ReactNode;
  className?: string;
  icon?: LucideIcon;
  title: ReactNode;
}) {
  return (
    <div className={cn("grid place-items-center px-6 py-16 text-center", className)}>
      <EmptyContent icon={icon} title={title}>
        {children}
      </EmptyContent>
    </div>
  );
}

export function ConsoleInsetPanel({
  children,
  className,
  dashed = false,
  icon,
  title,
}: {
  children?: ReactNode;
  className?: string;
  dashed?: boolean;
  icon?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-[#f8fafc] p-5 dark:bg-white/5",
        dashed
          ? "border-dashed border-[#cbd5e1] dark:border-white/15"
          : "border-[#e4e9f2] dark:border-white/10",
        className,
      )}
    >
      {title ? (
        <div className="flex items-center gap-2 text-sm font-black text-[#101828] dark:text-white">
          {icon ? <span className="text-[#2563eb] dark:text-[#93c5fd]">{icon}</span> : null}
          {title}
        </div>
      ) : null}
      {children ? (
        title ? (
          <div className="mt-2 text-sm font-semibold leading-6 text-[#667085] dark:text-[#98a2b3]">
            {children}
          </div>
        ) : (
          children
        )
      ) : null}
    </div>
  );
}

export function ConsoleSubPanel({
  actions,
  children,
  className,
  contentClassName,
  description,
  headerClassName,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  description?: ReactNode;
  headerClassName?: string;
  title?: ReactNode;
}) {
  const hasHeader = title || description || actions;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border border-[#e4e9f2] bg-white dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      {hasHeader ? (
        <div
          className={cn(
            "flex flex-col gap-2 border-b border-[#eef2f7] px-4 py-3 dark:border-white/10 sm:flex-row sm:items-start sm:justify-between",
            headerClassName,
          )}
        >
          <div className="min-w-0">
            {title ? (
              <p className="text-sm font-black text-[#101828] dark:text-white">
                {title}
              </p>
            ) : null}
            {description ? (
              <p className="mt-1 break-words text-xs font-semibold text-[#98a2b3]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </article>
  );
}

export function TableEmptyText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm font-semibold text-[#667085] dark:text-[#98a2b3]", className)}>
      {children}
    </p>
  );
}

type ConsoleModalMessageTone =
  | "danger"
  | "info"
  | "neutral"
  | "orange"
  | "purple"
  | "rose"
  | "success"
  | "teal";

const consoleModalMessageToneClasses: Record<ConsoleModalMessageTone, string> = {
  danger: "border-[#fee4e2]",
  info: "border-[#dbeafe]",
  neutral: "border-[#e4e9f2]",
  orange: "border-[#fed7aa]",
  purple: "border-[#ddd6fe]",
  rose: "border-[#fbcfe8]",
  success: "border-[#dcfce7]",
  teal: "border-[#ccfbf1]",
};

export function ConsoleModalMessage({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: ConsoleModalMessageTone;
}) {
  return (
    <p
      className={cn(
        "border-t p-5 text-sm font-bold text-[#2563eb] dark:text-[#93c5fd]",
        consoleModalMessageToneClasses[tone],
        className,
      )}
    >
      {children}
    </p>
  );
}

export function ConsoleConfirmSummary({
  children,
  className,
  tone = "danger",
}: {
  children: ReactNode;
  className?: string;
  tone?: "danger" | "neutral";
}) {
  return (
    <p
      className={cn(
        "break-all rounded-lg p-4 text-xs font-bold",
        tone === "danger"
          ? "bg-[#fff8f7] text-[#667085] dark:bg-[#450a0a]/30 dark:text-[#fda4af]"
          : "bg-[#f7f9fc] text-[#475467] dark:bg-white/5 dark:text-[#cbd5e1]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function InlineIconText({
  children,
  className,
  icon: Icon,
  iconClassName,
}: {
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]",
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} />
      {children}
    </span>
  );
}

export function ConsoleEyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs font-black uppercase tracking-wide text-[#667085] dark:text-[#98a2b3]",
        className,
      )}
    >
      {children}
    </span>
  );
}

type InlineStatItem = {
  icon?: LucideIcon;
  iconClassName?: string;
  label: ReactNode;
  value: ReactNode;
};

export function InlineStatList({
  className,
  columns = 1,
  items,
}: {
  className?: string;
  columns?: 1 | 2 | 3;
  items: InlineStatItem[];
}) {
  const columnClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-3",
  }[columns];

  return (
    <div className={cn("grid gap-3 text-sm", columnClass, className)}>
      {items.map((item, index) => {
        const Icon = item.icon;

        return (
          <div
            className="flex items-center justify-between gap-4 rounded-lg border border-[#eef2f7] bg-[#f8fafc] px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]"
            key={index}
          >
            <span className="inline-flex min-w-0 items-center gap-2 font-bold text-[#344054] dark:text-[#cbd5e1]">
              {Icon ? (
                <Icon
                  className={cn("size-4 shrink-0 text-[#2563eb] dark:text-[#93c5fd]", item.iconClassName)}
                />
              ) : null}
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 font-black text-[#101828] dark:text-white">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ConsoleCatalogCard({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  const classes = cn(
    "rounded-xl border border-[#e4e9f2] p-4 dark:border-white/10",
    href
      ? "block bg-white transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(16,24,40,0.08)] dark:bg-[#0b1220] dark:hover:bg-[#111827]"
      : "bg-[#fbfcfe] opacity-85 dark:bg-white/5",
    className,
  );

  if (href) {
    return (
      <Link className={classes} href={href}>
        {children}
      </Link>
    );
  }

  return <article className={classes}>{children}</article>;
}

export function ConsoleActionTile({
  children,
  className,
  disabled = false,
  href,
  icon,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  href?: string;
  icon?: ReactNode;
}) {
  const classes = cn(
    "flex items-center gap-3 rounded-xl border p-4 text-sm font-black transition",
    disabled
      ? "border-[#e4e9f2] bg-[#fbfcfe] text-[#667085] dark:border-white/10 dark:bg-white/5 dark:text-[#98a2b3]"
      : "border-[#e4e9f2] bg-[#fbfcfe] text-[#2563eb] hover:border-[#2563eb] hover:bg-[#eef4ff] dark:border-white/10 dark:bg-white/5 dark:text-[#93c5fd] dark:hover:border-[#3b82f6] dark:hover:bg-[#172554]",
    className,
  );
  const content = (
    <>
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0">{children}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <Link className={classes} href={href}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}

type SignalCardTone = "bad" | "good" | "neutral" | "warn";

const signalToneClasses: Record<SignalCardTone, string> = {
  bad: "bg-[#fff1f2] text-[#b42318] dark:bg-[#450a0a] dark:text-[#fecdd3]",
  good: "bg-[#e9f8f1] text-[#15803d] dark:bg-[#052e16] dark:text-[#86efac]",
  neutral: "bg-[#eef4ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]",
  warn: "bg-[#fff7ed] text-[#b54708] dark:bg-[#431407] dark:text-[#fdba74]",
};

export function SignalCard({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon?: ReactNode;
  label: ReactNode;
  tone?: SignalCardTone;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#e4e9f2] bg-white p-4 dark:border-white/10 dark:bg-[#0b1220]">
      {icon ? (
        <div className={cn("mb-3 grid size-9 place-items-center rounded-lg", signalToneClasses[tone])}>
          {icon}
        </div>
      ) : null}
      <p className="text-xs font-black uppercase text-[#667085] dark:text-[#98a2b3]">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-[#101828] dark:text-white">{value}</p>
    </div>
  );
}

export function InfoPill({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#e4e9f2] bg-[#f7f9fc] px-3 py-2">
      {icon ? <span className="text-[#667085]">{icon}</span> : null}
      <span className="min-w-0">
        <span className="block text-[11px] font-black uppercase text-[#667085]">
          {label}
        </span>
        <span className="break-words text-sm font-black text-[#101828]">
          {value}
        </span>
      </span>
    </div>
  );
}

export function UsageMeter({
  children,
  percent,
  tone = "blue",
}: {
  children?: ReactNode;
  percent: number;
  tone?: "blue" | "green";
}) {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const fillClassName =
    clampedPercent >= 85 ? "bg-[#d7000f]" : tone === "green" ? "bg-[#16a34a]" : "bg-[#2563eb]";

  return (
    <div className="p-5">
      <div className="h-3 overflow-hidden rounded-full bg-[#eef2f7]">
        <div
          className={cn("h-full rounded-full", fillClassName)}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

export function ConsoleUsageCell({
  className,
  detail,
  percent,
  tone = "blue",
  value,
}: {
  className?: string;
  detail?: ReactNode;
  percent: number;
  tone?: "blue" | "green";
  value: ReactNode;
}) {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const fillClassName =
    clampedPercent >= 85 ? "bg-[#d7000f]" : tone === "green" ? "bg-[#16a34a]" : "bg-[#2563eb]";

  return (
    <div className={cn("min-w-44 font-bold", className)}>
      <div className="h-2 overflow-hidden rounded-full bg-[#eef2f7] dark:bg-white/10">
        <div
          className={cn("h-full rounded-full", fillClassName)}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      <p className="mt-2 font-black text-[#101828] dark:text-white">{value}</p>
      {detail ? (
        <p className="mt-1 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

type ConsolePanelProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  title?: ReactNode;
};

export function ConsolePanel({
  actions,
  children,
  className,
  description,
  icon: Icon,
  iconClassName,
  title,
}: ConsolePanelProps) {
  const hasHeader = title || description || Icon || actions;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)] dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      {hasHeader ? (
        <div className="flex flex-col gap-4 border-b border-[#e4e9f2] p-5 dark:border-white/10 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {Icon ? <Icon className={cn("size-5 text-[#2563eb]", iconClassName)} /> : null}
              {title ? <h2 className="text-lg font-black text-[#101828] dark:text-white">{title}</h2> : null}
            </div>
            {description ? (
              <p className="mt-1 text-sm font-medium text-[#667085] dark:text-[#98a2b3]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ConsolePanelGrid({
  children,
  className,
  columns = 2,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3;
}) {
  return (
    <section
      className={cn(
        "grid gap-6",
        columns === 3 ? "xl:grid-cols-3" : "xl:grid-cols-2",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function ConsoleResponsiveGrid({
  children,
  className,
  variant = "lg-2",
}: {
  children: ReactNode;
  className?: string;
  variant?:
    | "lg-2"
    | "lg-3"
    | "lg-1.1-0.9"
    | "lg-1.5-1"
    | "xl-2"
    | "xl-1-0.8"
    | "xl-1.15-0.85";
}) {
  const variantClassName = {
    "lg-2": "lg:grid-cols-2",
    "lg-3": "lg:grid-cols-3",
    "lg-1.1-0.9": "lg:grid-cols-[1.1fr_0.9fr]",
    "lg-1.5-1": "lg:grid-cols-[1.5fr_1fr]",
    "xl-2": "xl:grid-cols-2",
    "xl-1-0.8": "xl:grid-cols-[1fr_0.8fr]",
    "xl-1.15-0.85": "xl:grid-cols-[1.15fr_0.85fr]",
  }[variant];

  return (
    <section className={cn("grid gap-4", variantClassName, className)}>
      {children}
    </section>
  );
}

export function ConsoleSplitLayout({
  children,
  className,
  order = "main-sidebar",
  sidebarWidth = "360",
  breakpoint = "xl",
}: {
  breakpoint?: "lg" | "xl" | "2xl";
  children: ReactNode;
  className?: string;
  order?: "main-sidebar" | "sidebar-main";
  sidebarWidth?: "280" | "320" | "360" | "380";
}) {
  const columnClassName = {
    "2xl-280": "2xl:grid-cols-[1fr_280px]",
    "2xl-320": "2xl:grid-cols-[1fr_320px]",
    "2xl-360": "2xl:grid-cols-[1fr_360px]",
    "2xl-380": "2xl:grid-cols-[1fr_380px]",
    "2xl-first-280": "2xl:grid-cols-[280px_1fr]",
    "2xl-first-320": "2xl:grid-cols-[320px_1fr]",
    "2xl-first-360": "2xl:grid-cols-[360px_1fr]",
    "2xl-first-380": "2xl:grid-cols-[380px_1fr]",
    "xl-280": "xl:grid-cols-[1fr_280px]",
    "xl-320": "xl:grid-cols-[1fr_320px]",
    "xl-360": "xl:grid-cols-[1fr_360px]",
    "xl-380": "xl:grid-cols-[1fr_380px]",
    "xl-first-280": "xl:grid-cols-[280px_1fr]",
    "xl-first-320": "xl:grid-cols-[320px_1fr]",
    "xl-first-360": "xl:grid-cols-[360px_1fr]",
    "xl-first-380": "xl:grid-cols-[380px_1fr]",
    "lg-280": "lg:grid-cols-[1fr_280px]",
    "lg-320": "lg:grid-cols-[1fr_320px]",
    "lg-360": "lg:grid-cols-[1fr_360px]",
    "lg-380": "lg:grid-cols-[1fr_380px]",
    "lg-first-280": "lg:grid-cols-[280px_1fr]",
    "lg-first-320": "lg:grid-cols-[320px_1fr]",
    "lg-first-360": "lg:grid-cols-[360px_1fr]",
    "lg-first-380": "lg:grid-cols-[380px_1fr]",
  }[
    order === "sidebar-main"
      ? `${breakpoint}-first-${sidebarWidth}`
      : `${breakpoint}-${sidebarWidth}`
  ];

  return (
    <section className={cn("grid gap-6", columnClassName, className)}>
      {children}
    </section>
  );
}

export function ConsoleSidebarStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn("grid content-start gap-6", className)}>
      {children}
    </aside>
  );
}

export function ConsoleDescriptionPanel({
  children,
  label = "Description",
}: {
  children: ReactNode;
  label?: ReactNode;
}) {
  return (
    <ConsolePanel className="p-5">
      <p className="text-sm font-bold text-[#667085] dark:text-[#98a2b3]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#101828] dark:text-white">
        {children}
      </p>
    </ConsolePanel>
  );
}

export function ConsoleSurface({
  actions,
  children,
  className,
  description,
  headerClassName,
  status,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  headerClassName?: string;
  status?: ReactNode;
  title?: ReactNode;
}) {
  const hasHeader = title || description || status || actions;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)] dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      {hasHeader ? (
        <div
          className={cn(
            "relative z-20 flex flex-col gap-3 border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4 dark:border-white/10 dark:bg-[#111827] sm:flex-row sm:items-center sm:justify-between",
            headerClassName,
          )}
        >
          <div>
            {title ? <h2 className="text-lg font-black text-[#101828] dark:text-white">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
                {description}
              </p>
            ) : null}
            {status ? <div className="mt-1">{status}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ConsoleTableToolbar({
  actions,
  children,
  className,
  stackAt = "md",
  tone = "default",
}: {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  stackAt?: "lg" | "md";
  tone?: "default" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-[#eef2f7] px-5 py-3 dark:border-white/10",
        stackAt === "lg"
          ? "lg:flex-row lg:items-center lg:justify-between"
          : "md:flex-row md:items-center md:justify-between",
        tone === "muted" ? "bg-[#fbfcfe] dark:bg-white/[0.03]" : "bg-white dark:bg-[#0b1220]",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type ConsoleCalloutProps = {
  children: ReactNode;
  className?: string;
  tone?: "danger" | "info" | "success" | "warning";
};

export function ConsoleCallout({
  children,
  className,
  tone = "danger",
}: ConsoleCalloutProps) {
  const tones = {
    danger: "border-[#fecdd3] bg-[#fff1f2] text-[#b42318] dark:border-[#fda4af]/30 dark:bg-[#450a0a] dark:text-[#fecdd3]",
    info: "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] dark:border-[#2563eb]/40 dark:bg-[#0b1730] dark:text-[#93c5fd]",
    success: "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534] dark:border-[#22c55e]/30 dark:bg-[#052e16] dark:text-[#bbf7d0]",
    warning: "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c] dark:border-[#9a3412] dark:bg-[#431407] dark:text-[#fdba74]",
  };

  return (
    <section className={cn("rounded-xl border p-4 text-sm font-bold", tones[tone], className)}>
      {children}
    </section>
  );
}

export function ConsoleInlineMessage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-lg bg-[#f8fafc] px-3 py-2 text-sm font-bold text-[#667085] dark:bg-white/5 dark:text-[#98a2b3]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function ConsoleMutedText({
  as = "p",
  children,
  className,
  size = "sm",
  weight = "bold",
}: {
  as?: "div" | "p" | "span";
  children: ReactNode;
  className?: string;
  size?: "sm" | "xs";
  weight?: "bold" | "semibold";
}) {
  const Component = as;

  return (
    <Component
      className={cn(
        size === "xs" ? "text-xs" : "text-sm",
        weight === "semibold" ? "font-semibold" : "font-bold",
        "text-[#667085] dark:text-[#98a2b3]",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function ConsolePanelBody({
  children,
  className,
  columns = "none",
  gap = "lg",
}: {
  children: ReactNode;
  className?: string;
  columns?: "none" | "md-2" | "lg-2" | "md-3";
  gap?: "md" | "lg";
}) {
  const columnClassName = {
    "lg-2": "lg:grid-cols-2",
    "md-2": "md:grid-cols-2",
    "md-3": "md:grid-cols-3",
    none: null,
  }[columns];

  return (
    <div
      className={cn(
        "grid p-5",
        gap === "lg" ? "gap-5" : "gap-4",
        columnClassName,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ConsolePanelHeader({
  actions,
  children,
  className,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-[#e4e9f2] p-5 dark:border-white/10 md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ConsolePanelActionBar({
  actions,
  children,
  className,
  align = "end",
}: {
  actions?: ReactNode;
  align?: "between" | "end" | "start";
  children?: ReactNode;
  className?: string;
}) {
  const alignClassName = {
    between: "justify-between",
    end: "justify-end",
    start: "justify-start",
  }[align];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-[#eef2f7] p-5 dark:border-white/10 sm:flex-row sm:items-center",
        alignClassName,
        className,
      )}
    >
      {children ? <div className="min-w-0 flex-1">{children}</div> : null}
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ConsoleFormFieldGrid({
  children,
  className,
  columns = "md-2",
}: {
  children: ReactNode;
  className?: string;
  columns?: "md-2" | "lg-2" | "md-3";
}) {
  const columnClassName = {
    "lg-2": "lg:grid-cols-2",
    "md-2": "md:grid-cols-2",
    "md-3": "md:grid-cols-3",
  }[columns];

  return (
    <div className={cn("grid gap-5", columnClassName, className)}>
      {children}
    </div>
  );
}

export function ConsoleSelectedItemsToolbar({
  actions,
  children,
  className,
  icon,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-[#e4e9f2] bg-[#f7f9fc] px-5 py-4 dark:border-white/10 dark:bg-white/[0.03] lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <ConsoleIconTile className="bg-[#eef4ff] text-[#2563eb]" size="sm">
            {icon}
          </ConsoleIconTile>
        ) : null}
        <div className="min-w-0">{children}</div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ConsoleDangerZone({
  actions,
  children,
  className,
  icon,
  title = "Danger zone",
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[#fecdd3] bg-[#fff1f2] p-5 dark:border-[#fda4af]/30 dark:bg-[#450a0a]",
        className,
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          {icon ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#fee2e2] text-[#b42318] dark:bg-[#7f1d1d] dark:text-[#fecdd3]">
              {icon}
            </span>
          ) : null}
          <div>
            <h2 className="text-base font-black text-[#7f1d1d] dark:text-[#fecdd3]">{title}</h2>
            <p className="mt-1 text-sm font-semibold text-[#b42318] dark:text-[#fecdd3]">
              {children}
            </p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </section>
  );
}

type ConsoleModalTone = "danger" | "default";

const modalToneClasses: Record<ConsoleModalTone, {
  border: string;
  headerBorder: string;
  title: string;
}> = {
  danger: {
    border: "border-[#fecdd3]",
    headerBorder: "border-[#fee4e2]",
    title: "text-[#b42318]",
  },
  default: {
    border: "border-[#d9e0eb]",
    headerBorder: "border-[#e4e9f2]",
    title: "text-[#101828]",
  },
};

export function ConsoleModal({
  children,
  closeLabel = "Close dialog",
  description,
  footer,
  maxWidthClassName = "max-w-lg",
  onClose,
  panelClassName,
  title,
  tone = "default",
}: {
  children: ReactNode;
  closeLabel?: string;
  description?: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
  onClose: () => void;
  panelClassName?: string;
  title: ReactNode;
  tone?: ConsoleModalTone;
}) {
  const toneClasses = modalToneClasses[tone];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#101828]/35 p-4">
      <section
        className={cn(
          "w-full rounded-xl border bg-white shadow-2xl",
          maxWidthClassName,
          toneClasses.border,
          panelClassName,
        )}
      >
        <div className={cn("flex items-start justify-between gap-4 border-b p-5", toneClasses.headerBorder)}>
          <div>
            <h2 className={cn("text-xl font-black", toneClasses.title)}>{title}</h2>
            {description ? (
              <p className="mt-1 text-sm font-semibold text-[#667085]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label={closeLabel}
            className="grid size-9 place-items-center rounded-lg border border-[#d9e0eb] hover:bg-[#f8fafc]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
        {footer ? (
          <div className={cn("flex flex-col gap-3 border-t p-5 md:flex-row md:items-center md:justify-between", toneClasses.headerBorder)}>
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function ConsoleModalBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("grid gap-4 p-5", className)}>{children}</div>;
}

export function ConsoleModalActions({
  children,
  className,
  justify = "end",
}: {
  children: ReactNode;
  className?: string;
  justify?: "between" | "end" | "start";
}) {
  return (
    <ConsoleActionGroup className={className} justify={justify}>
      {children}
    </ConsoleActionGroup>
  );
}

export function ConsoleModalFooterNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm font-bold text-[#667085] dark:text-[#98a2b3]", className)}>
      {children}
    </p>
  );
}

export function ConsoleActionGroup({
  children,
  className,
  justify = "start",
}: {
  children: ReactNode;
  className?: string;
  justify?: "between" | "end" | "start";
}) {
  const justifyClassName = {
    between: "justify-between",
    end: "justify-end",
    start: "justify-start",
  }[justify];

  return (
    <div className={cn("flex flex-wrap gap-3", justifyClassName, className)}>
      {children}
    </div>
  );
}

export function ConsoleActionFeedback({
  children,
  className,
  size = "md",
  tone = "info",
}: {
  children: ReactNode;
  className?: string;
  size?: "md" | "xs";
  tone?: "danger" | "info" | "success";
}) {
  const toneClassName = {
    danger: "text-[#b42318] dark:text-[#fda29b]",
    info: "text-[#2563eb] dark:text-[#93c5fd]",
    success: "text-[#15803d] dark:text-[#86efac]",
  }[tone];
  const sizeClassName = {
    md: "text-sm",
    xs: "text-xs",
  }[size];

  return (
    <p className={cn("font-bold", sizeClassName, toneClassName, className)}>
      {children}
    </p>
  );
}

export function ConsoleActionStack({
  children,
  className,
  gap = "sm",
}: {
  children: ReactNode;
  className?: string;
  gap?: "md" | "sm" | "xs";
}) {
  const gapClassName = {
    md: "grid gap-3",
    sm: "grid gap-2",
    xs: "grid gap-1",
  }[gap];

  return (
    <div className={cn(gapClassName, className)}>
      {children}
    </div>
  );
}

export type StatusTone = "bad" | "good" | "neutral" | "warn";

const statusToneClasses: Record<StatusTone, string> = {
  bad: "border-[#fecdd3] bg-[#fff1f2] text-[#b42318]",
  good: "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]",
  neutral: "border-[#d9e0eb] bg-[#f8fafc] text-[#475467]",
  warn: "border-[#fedf89] bg-[#fffbeb] text-[#92400e]",
};

export function statusToneFromText(status: string): StatusTone {
  const normalized = status.toLowerCase();

  if (
    ["active", "available", "enabled", "healthy", "in-use", "normal", "online", "running", "success", "succeeded"].includes(
      normalized,
    )
  ) {
    return "good";
  }

  if (
    normalized.includes("abnormal") ||
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("fault") ||
    normalized.includes("offline") ||
    normalized.includes("unavailable")
  ) {
    return "bad";
  }

  if (
    normalized.includes("backup") ||
    normalized.includes("creating") ||
    normalized.includes("deleting") ||
    normalized.includes("pending") ||
    normalized.includes("reboot") ||
    normalized.includes("restart") ||
    normalized.includes("restoring") ||
    normalized.includes("scaling") ||
    normalized.includes("starting")
  ) {
    return "warn";
  }

  return "neutral";
}

export function StatusBadge({
  children,
  className,
  status,
  tone,
}: {
  children?: ReactNode;
  className?: string;
  status?: string;
  tone?: StatusTone;
}) {
  const resolvedTone = tone ?? statusToneFromText(status ?? "");

  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-black",
        statusToneClasses[resolvedTone],
        className,
      )}
    >
      {children ?? status}
    </span>
  );
}

type ConsolePillTone = "good" | "info" | "neutral" | "warn";

const consolePillToneClasses: Record<ConsolePillTone, string> = {
  good: "bg-[#e9f8f1] text-[#15803d] dark:bg-[#052e16] dark:text-[#86efac]",
  info: "bg-[#eef4ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]",
  neutral: "bg-[#f2f4f7] text-[#667085] dark:bg-white/10 dark:text-[#cbd5e1]",
  warn: "bg-[#fff7ed] text-[#c2410c] dark:bg-[#431407] dark:text-[#fdba74]",
};

export function ConsolePill({
  children,
  className,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  tone?: ConsolePillTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black",
        consolePillToneClasses[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function ConsoleMonoText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("font-mono text-xs font-semibold text-[#667085] dark:text-[#98a2b3]", className)}>
      {children}
    </span>
  );
}

export function ResourceIdentity({
  className,
  description,
  descriptionClassName,
  href,
  id,
  idClassName,
  name,
  scope,
  scopeClassName,
}: {
  className?: string;
  description?: ReactNode;
  descriptionClassName?: string;
  href?: string;
  id?: ReactNode;
  idClassName?: string;
  name: ReactNode;
  scope?: ReactNode;
  scopeClassName?: string;
}) {
  return (
    <>
      {href ? (
        <ConsoleResourceLink className={className} href={href} underline={false}>
          {name}
        </ConsoleResourceLink>
      ) : (
        <p className={cn("font-black", className)}>{name}</p>
      )}
      {id ? (
        <p className={cn("mt-1 break-all text-xs font-semibold text-[#98a2b3]", idClassName)}>
          {id}
        </p>
      ) : null}
      {scope ? (
        <p className={cn("mt-1 text-xs font-bold text-[#667085]", scopeClassName)}>{scope}</p>
      ) : null}
      {description ? (
        <p className={cn("mt-2 text-xs text-[#667085] dark:text-[#98a2b3]", descriptionClassName)}>
          {description}
        </p>
      ) : null}
    </>
  );
}

export function CellStack({
  children,
  className,
  subValue,
  subValueClassName,
}: {
  children: ReactNode;
  className?: string;
  subValue?: ReactNode;
  subValueClassName?: string;
}) {
  return (
    <>
      <p className={className}>{children}</p>
      {subValue ? (
        <p className={cn("mt-1 text-xs text-[#667085]", subValueClassName)}>{subValue}</p>
      ) : null}
    </>
  );
}

export function ProjectRegionCell({
  projectId,
  projectName,
  region,
}: {
  projectId?: ReactNode;
  projectName?: ReactNode;
  region?: ReactNode;
}) {
  return (
    <CellStack subValue={region || projectId || "-"}>
      {projectName || projectId || "-"}
    </CellStack>
  );
}

export function StorageCell({
  storage,
  storageType,
}: {
  storage: ReactNode;
  storageType?: ReactNode;
}) {
  return <CellStack subValue={storageType || "-"}>{storage || "-"}</CellStack>;
}

export function BackupRetentionCell({
  backupWindow,
  keepDays,
}: {
  backupWindow: ReactNode;
  keepDays?: ReactNode;
}) {
  return (
    <CellStack subValue={keepDays ? `Keep ${keepDays} days` : "Retention not reported"}>
      {backupWindow || "-"}
    </CellStack>
  );
}

export type SimpleTableColumn = {
  className?: string;
  header: ReactNode;
  headerClassName?: string;
};

export type SimpleTableRow = {
  cells: ReactNode[];
  className?: string;
  key: string;
};

export function SimpleTable({
  className,
  columns,
  emptyState,
  minWidthClassName = "min-w-[760px]",
  rows,
}: {
  className?: string;
  columns: SimpleTableColumn[];
  emptyState: ReactNode;
  minWidthClassName?: string;
  rows: SimpleTableRow[];
}) {
  if (!rows.length) {
    return (
      <div className="grid place-items-center px-6 py-12 text-center">
        {emptyState}
      </div>
    );
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className={cn("w-full text-left text-sm", minWidthClassName)}>
        <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085] dark:bg-white/5 dark:text-[#98a2b3]">
          <tr>
            {columns.map((column, index) => (
              <th
                className={cn("px-5 py-3", column.headerClassName)}
                key={index}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#eef2f7] dark:divide-white/10">
          {rows.map((row) => (
            <tr className={row.className} key={row.key}>
              {columns.map((column, index) => (
                <td
                  className={cn("px-5 py-4 align-top font-semibold", column.className)}
                  key={`${row.key}:${index}`}
                >
                  {row.cells[index] ?? null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConsoleFramedTable({
  className,
  columns,
  emptyState,
  minWidthClassName,
  rows,
}: {
  className?: string;
  columns: SimpleTableColumn[];
  emptyState: ReactNode;
  minWidthClassName?: string;
  rows: SimpleTableRow[];
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-[#e4e9f2] dark:border-white/10",
        className,
      )}
    >
      <SimpleTable
        columns={columns}
        emptyState={emptyState}
        minWidthClassName={minWidthClassName}
        rows={rows}
      />
    </div>
  );
}

export function ConsoleTablePanel({
  className,
  columns,
  description,
  emptyState,
  minWidthClassName = "min-w-[760px]",
  rows,
  title,
}: {
  className?: string;
  columns: SimpleTableColumn[];
  description?: ReactNode;
  emptyState: ReactNode;
  minWidthClassName?: string;
  rows: SimpleTableRow[];
  title: ReactNode;
}) {
  return (
    <ConsolePanel description={description} title={title}>
      <SimpleTable
        className={className}
        columns={columns}
        emptyState={emptyState}
        minWidthClassName={minWidthClassName}
        rows={rows}
      />
    </ConsolePanel>
  );
}
