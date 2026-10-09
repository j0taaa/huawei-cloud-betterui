import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

export function ConsoleField({
  as = "label",
  children,
  className,
  helpText,
  label,
}: {
  as?: "div" | "label";
  children: ReactNode;
  className?: string;
  helpText?: ReactNode;
  label: ReactNode;
}) {
  const Component = as;

  return (
    <Component className={cn("grid gap-2 text-sm font-bold", className)}>
      <span>{label}</span>
      {children}
      {helpText ? (
        <span className="text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
          {helpText}
        </span>
      ) : null}
    </Component>
  );
}

type ConsoleControlFocusTone =
  | "danger"
  | "info"
  | "orange"
  | "primary"
  | "purple"
  | "rose"
  | "success"
  | "teal";

const consoleControlFocusToneClasses: Record<ConsoleControlFocusTone, string> = {
  danger: "focus:border-[#b42318] focus:ring-[#fee4e2] dark:focus:border-[#fda4af] dark:focus:ring-[#7f1d1d]",
  info: "focus:border-[#0284c7] focus:ring-[#e0f2fe] dark:focus:border-[#38bdf8] dark:focus:ring-[#075985]",
  orange: "focus:border-[#c2410c] focus:ring-[#fed7aa] dark:focus:border-[#fdba74] dark:focus:ring-[#9a3412]",
  primary: "focus:border-[#2563eb] focus:ring-[#dbeafe] dark:focus:border-[#60a5fa] dark:focus:ring-[#1e3a8a]",
  purple: "focus:border-[#7c3aed] focus:ring-[#ede9fe] dark:focus:border-[#c4b5fd] dark:focus:ring-[#4c1d95]",
  rose: "focus:border-[#be185d] focus:ring-[#fce7f3] dark:focus:border-[#f9a8d4] dark:focus:ring-[#831843]",
  success: "focus:border-[#16a34a] focus:ring-[#dcfce7] dark:focus:border-[#86efac] dark:focus:ring-[#166534]",
  teal: "focus:border-[#0891b2] focus:ring-[#cffafe] dark:focus:border-[#67e8f9] dark:focus:ring-[#164e63]",
};

const consoleControlBaseClassName =
  "w-full rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-semibold text-[#101828] outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#98a2b3] dark:border-white/10 dark:bg-[#0b1220] dark:text-white dark:disabled:bg-white/5";

export const ConsoleInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    focusTone?: ConsoleControlFocusTone;
  }
>(function ConsoleInput(
  { className, focusTone = "primary", ...props },
  ref,
) {
  return (
    <input
      className={cn(
        consoleControlBaseClassName,
        "h-11",
        consoleControlFocusToneClasses[focusTone],
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export function ConsoleSelect({
  className,
  focusTone = "primary",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  focusTone?: ConsoleControlFocusTone;
}) {
  return (
    <select
      className={cn(
        consoleControlBaseClassName,
        "h-11",
        consoleControlFocusToneClasses[focusTone],
        className,
      )}
      {...props}
    />
  );
}

export function ConsoleTextarea({
  className,
  focusTone = "primary",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  focusTone?: ConsoleControlFocusTone;
}) {
  return (
    <textarea
      className={cn(
        consoleControlBaseClassName,
        "min-h-24 py-2",
        consoleControlFocusToneClasses[focusTone],
        className,
      )}
      {...props}
    />
  );
}

export function ConsoleCheckbox({
  className,
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 text-sm font-bold text-[#101828] dark:text-white",
        className,
      )}
    >
      <input
        className="size-4 rounded border-[#d9e0eb] text-[#2563eb] focus:ring-[#dbeafe] dark:border-white/10 dark:bg-[#0b1220]"
        type="checkbox"
        {...props}
      />
      {label}
    </label>
  );
}

export function ConsoleCheckboxOption({
  className,
  label,
  labelClassName,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  labelClassName?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-lg border border-[#eef2f7] px-3 py-2 font-bold hover:bg-[#fbfcfe] dark:border-white/10 dark:hover:bg-white/5",
        className,
      )}
    >
      <input
        className="size-4 rounded border-[#d9e0eb] text-[#2563eb] focus:ring-[#dbeafe] dark:border-white/10 dark:bg-[#0b1220]"
        type="checkbox"
        {...props}
      />
      <span className={cn("min-w-0 flex-1 truncate", labelClassName)}>{label}</span>
    </label>
  );
}
