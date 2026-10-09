"use client";

import { Search, X } from "lucide-react";
import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function ConsoleSearchInput({
  className,
  clearLabel = "Clear search",
  inputClassName,
  label,
  onValueChange,
  value = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  clearLabel?: string;
  inputClassName?: string;
  label: string;
  onValueChange?: (value: string) => void;
  value?: string;
}) {
  const isControlled = Boolean(onValueChange);

  return (
    <label className={cn("relative block w-full", className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#667085]" />
      <input
        className={cn(
          "h-10 w-full rounded-lg border border-[#d9e0eb] bg-[#fbfcfe] pl-9 text-sm font-semibold outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe] dark:border-white/10 dark:bg-[#111827] dark:text-white dark:focus:bg-[#0b1220]",
          value ? "pr-10" : "pr-3",
          inputClassName,
        )}
        onChange={onValueChange ? (event) => onValueChange(event.currentTarget.value) : undefined}
        type="search"
        value={isControlled ? value : undefined}
        {...props}
      />
      {isControlled && value ? (
        <button
          aria-label={clearLabel}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[#667085] hover:bg-[#eef2f7] hover:text-[#344054] dark:text-[#98a2b3] dark:hover:bg-white/10 dark:hover:text-white"
          onClick={() => onValueChange?.("")}
          type="button"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </label>
  );
}
