"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ConsoleTabItem<TId extends string = string> = {
  content?: ReactNode;
  count?: ReactNode;
  icon?: ReactNode;
  id: TId;
  label: ReactNode;
};

type ConsoleTabVariant = "pills" | "sidebar" | "underline";
type ConsoleTabSize = "md" | "sm";

const tabListVariantClasses: Record<ConsoleTabVariant, string> = {
  pills:
    "flex gap-1 overflow-x-auto border-b border-[#e4e9f2] bg-[#f8fafc] p-2 dark:border-white/10 dark:bg-[#111827]",
  sidebar: "grid gap-1",
  underline: "flex gap-2 overflow-x-auto",
};

const tabButtonSizeClasses: Record<ConsoleTabSize, string> = {
  md: "h-11",
  sm: "h-10",
};

export function ConsoleTabNav<TId extends string>({
  activeId,
  ariaLabel,
  className,
  idPrefix,
  onSelect,
  size = "sm",
  tabs,
  variant = "underline",
}: {
  activeId: TId;
  ariaLabel: string;
  className?: string;
  idPrefix?: string;
  onSelect: (id: TId) => void;
  size?: ConsoleTabSize;
  tabs: Array<ConsoleTabItem<TId>>;
  variant?: ConsoleTabVariant;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(tabListVariantClasses[variant], className)}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        const tabId = idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined;
        const panelId = idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined;

        return (
          <button
            aria-controls={panelId}
            aria-selected={selected}
            className={cn(
              "transition",
              variant === "underline"
                ? [
                    "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-black",
                    tabButtonSizeClasses[size],
                    selected
                      ? "border-[#2563eb] text-[#2563eb]"
                      : "border-transparent text-[#667085] hover:border-[#bfdbfe] hover:text-[#1d4ed8]",
                  ]
                : null,
              variant === "pills"
                ? [
                    "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-black",
                    tabButtonSizeClasses[size],
                    selected
                      ? "bg-[#2563eb] text-white shadow-sm"
                      : "text-[#475467] hover:bg-white hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white",
                  ]
                : null,
              variant === "sidebar"
                ? [
                    "flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-black",
                    selected
                      ? "bg-[#2563eb] text-white shadow-sm"
                      : "text-[#475467] hover:bg-white hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white",
                  ]
                : null,
            )}
            id={tabId}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            role="tab"
            type="button"
          >
            {tab.icon ? (
              <span
                className={cn(
                  "shrink-0",
                  selected && variant !== "underline"
                    ? "text-white"
                    : "text-[#2563eb] dark:text-[#93c5fd]",
                )}
              >
                {tab.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px]",
                  selected
                    ? "bg-[#dbeafe] text-[#1d4ed8]"
                    : "bg-[#eef2f7] text-[#667085]",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ConsoleTabs<TId extends string>({
  ariaLabel,
  className,
  defaultId,
  emptyState,
  headerClassName,
  idPrefix,
  panelClassName,
  size = "sm",
  tabs,
  variant = "underline",
}: {
  ariaLabel: string;
  className?: string;
  defaultId?: TId;
  emptyState?: ReactNode;
  headerClassName?: string;
  idPrefix?: string;
  panelClassName?: string;
  size?: ConsoleTabSize;
  tabs: Array<ConsoleTabItem<TId> & { content: ReactNode }>;
  variant?: ConsoleTabVariant;
}) {
  const [activeId, setActiveId] = useState<TId | "">(() => defaultId ?? tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  if (!activeTab) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div className={className}>
      <div className={headerClassName}>
        <ConsoleTabNav
          activeId={activeTab.id}
          ariaLabel={ariaLabel}
          idPrefix={idPrefix}
          onSelect={setActiveId}
          size={size}
          tabs={tabs}
          variant={variant}
        />
      </div>
      <div
        aria-labelledby={idPrefix ? `${idPrefix}-tab-${activeTab.id}` : undefined}
        className={panelClassName}
        id={idPrefix ? `${idPrefix}-panel-${activeTab.id}` : undefined}
        role="tabpanel"
      >
        {activeTab.content}
      </div>
    </div>
  );
}
