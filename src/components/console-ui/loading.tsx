import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ConsoleSkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-full bg-[#e4e9f2] dark:bg-white/10", className)}
    />
  );
}

export function ConsoleLoadingChip({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm dark:border-white/10 dark:bg-[#111827]",
        className,
      )}
    >
      {icon}
      {children}
    </div>
  );
}

export function ConsoleSkeletonButton({ className }: { className?: string }) {
  return (
    <ConsoleSkeletonBlock
      className={cn(
        "h-11 rounded-lg border border-[#d9e0eb] bg-white shadow-sm dark:border-white/10 dark:bg-[#111827]",
        className,
      )}
    />
  );
}

export function ConsoleSkeletonRow({
  children,
  className,
  columns = 4,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3 | 4;
}) {
  const columnClassName = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-4",
  }[columns];

  return (
    <div
      className={cn(
        "grid gap-4 rounded-lg border border-[#eef2f7] p-4 dark:border-white/10",
        columnClassName,
        className,
      )}
    >
      {children}
    </div>
  );
}
