import Link from "next/link";
import { X, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type ConsoleButtonSize = "lg" | "md" | "sm" | "xs";
type ConsoleButtonVariant =
  | "danger"
  | "dangerOutline"
  | "ghost"
  | "infoOutline"
  | "neutral"
  | "orange"
  | "orangeOutline"
  | "primary"
  | "primaryOutline"
  | "purple"
  | "success"
  | "successOutline"
  | "teal";

const consoleButtonVariantClasses: Record<ConsoleButtonVariant, string> = {
  danger: "border border-[#b42318] bg-[#b42318] text-white hover:bg-[#912018]",
  dangerOutline: "border border-[#fecdd3] bg-white text-[#b42318] hover:bg-[#fff1f2] dark:border-[#7f1d1d] dark:bg-[#111827] dark:text-[#fecdd3] dark:hover:bg-[#450a0a]",
  ghost: "text-[#475467] hover:bg-[#eef2f7] hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white",
  infoOutline: "border border-[#bae6fd] bg-white text-[#0369a1] hover:bg-[#f0f9ff] dark:border-[#075985] dark:bg-[#111827] dark:text-[#7dd3fc] dark:hover:bg-[#082f49]",
  neutral: "border border-[#d9e0eb] bg-white text-[#344054] hover:bg-[#f8fafc] dark:border-white/10 dark:bg-[#111827] dark:text-[#cbd5e1] dark:hover:bg-white/10",
  orange: "border border-[#c2410c] bg-[#c2410c] text-white hover:bg-[#9a3412]",
  orangeOutline: "border border-[#fed7aa] bg-white text-[#c2410c] hover:bg-[#fff7ed] dark:border-[#9a3412] dark:bg-[#111827] dark:text-[#fdba74] dark:hover:bg-[#431407]",
  primary: "border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#1d4ed8]",
  primaryOutline: "border border-[#155eef] bg-white text-[#155eef] hover:bg-[#eff6ff] dark:border-[#1d4ed8] dark:bg-[#111827] dark:text-[#93c5fd] dark:hover:bg-[#172554]",
  purple: "border border-[#7c3aed] bg-[#7c3aed] text-white hover:bg-[#6d28d9]",
  success: "border border-[#16a34a] bg-[#16a34a] text-white hover:bg-[#15803d]",
  successOutline: "border border-[#bbf7d0] bg-white text-[#15803d] hover:bg-[#f0fdf4] dark:border-[#166534] dark:bg-[#111827] dark:text-[#86efac] dark:hover:bg-[#052e16]",
  teal: "border border-[#0f766e] bg-[#0f766e] text-white hover:bg-[#115e59]",
};

const consoleButtonSizeClasses: Record<ConsoleButtonSize, string> = {
  lg: "h-11 rounded-lg px-4 text-sm",
  md: "h-10 rounded-lg px-4 text-sm",
  sm: "h-9 rounded-md px-3 text-sm",
  xs: "h-8 rounded-md px-2.5 text-xs",
};

export function ConsoleButton({
  children,
  className,
  size = "sm",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ConsoleButtonSize;
  variant?: ConsoleButtonVariant;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60",
        consoleButtonSizeClasses[size],
        consoleButtonVariantClasses[variant],
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
export function ConsoleLinkButton({
  children,
  className,
  size = "sm",
  variant = "primary",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  size?: ConsoleButtonSize;
  variant?: ConsoleButtonVariant;
}) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-2 font-bold shadow-sm transition",
        consoleButtonSizeClasses[size],
        consoleButtonVariantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export function ConsoleToolbarButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <ConsoleButton className={className} size="md" variant="neutral" {...props}>
      {children}
    </ConsoleButton>
  );
}

type ConsoleActionButtonTone = "danger" | "neutral" | "primary" | "success";

const consoleActionButtonToneVariant: Record<
  ConsoleActionButtonTone,
  ConsoleButtonVariant
> = {
  danger: "dangerOutline",
  neutral: "neutral",
  primary: "primary",
  success: "success",
};

export function ConsoleActionButton({
  children,
  className,
  prominence = "default",
  tone = "neutral",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  prominence?: "default" | "hero";
  tone?: ConsoleActionButtonTone;
}) {
  return (
    <ConsoleButton
      className={cn(
        prominence === "hero" && tone === "primary"
          ? "shadow-[0_12px_28px_rgba(37,99,235,0.28)]"
          : null,
        prominence === "hero" && tone === "success"
          ? "shadow-[0_12px_28px_rgba(21,128,61,0.24)]"
          : null,
        className,
      )}
      size={prominence === "hero" ? "lg" : "sm"}
      variant={consoleActionButtonToneVariant[tone]}
      {...props}
    >
      {children}
    </ConsoleButton>
  );
}

export const ConsoleIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ConsoleButtonVariant;
  }
>(function ConsoleIconButton(
  { children, className, variant = "ghost", ...props },
  ref,
) {
  return (
    <button
      className={cn(
        "grid size-8 place-items-center rounded-md transition disabled:opacity-60",
        consoleButtonVariantClasses[variant],
        className,
      )}
      ref={ref}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
});

export function ConsoleSplitActionChip({
  actionLabel,
  children,
  className,
  onAction,
  onRemove,
  removeLabel,
}: {
  actionLabel?: string;
  children: ReactNode;
  className?: string;
  onAction: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center overflow-hidden rounded-md border border-[#d9e0eb] bg-white text-sm font-bold dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      <button
        aria-label={actionLabel}
        className="h-full px-3 text-[#475467] transition hover:bg-[#eef2f7] hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white"
        onClick={onAction}
        type="button"
      >
        {children}
      </button>
      <button
        aria-label={removeLabel}
        className="grid h-full w-9 place-items-center border-l border-[#e4e9f2] text-[#b42318] transition hover:bg-[#fee2e2] dark:border-white/10 dark:text-[#fda4af] dark:hover:bg-[#450a0a]"
        onClick={onRemove}
        title={removeLabel}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

export function ConsoleRemovablePill({
  children,
  className,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  className?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-black text-[#2563eb] dark:border-[#2563eb]/40 dark:bg-[#172554] dark:text-[#93c5fd]",
        className,
      )}
    >
      <span className="truncate">{children}</span>
      <button
        aria-label={removeLabel}
        className="grid size-5 place-items-center rounded-full hover:bg-[#dbeafe] dark:hover:bg-white/10"
        onClick={onRemove}
        type="button"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

export function ConsoleFloatingMenuPanel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[#d9e0eb] bg-white p-1.5 shadow-[0_18px_42px_rgba(16,24,40,0.18)] dark:border-white/10 dark:bg-[#111827] dark:shadow-[0_18px_42px_rgba(0,0,0,0.45)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ConsoleMenuItem({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold text-[#344054] transition hover:bg-[#f3f6fb] hover:text-[#101828] dark:text-[#d0d5dd] dark:hover:bg-white/10 dark:hover:text-white",
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function ConsoleMenuLink({
  children,
  className,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
}) {
  return (
    <Link
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold text-[#344054] transition hover:bg-[#f3f6fb] hover:text-[#101828] dark:text-[#d0d5dd] dark:hover:bg-white/10 dark:hover:text-white",
        className,
      )}
      href={href}
      {...props}
    >
      {children}
    </Link>
  );
}

export function ConsoleListOptionButton({
  active = false,
  badge,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  badge?: ReactNode;
}) {
  return (
    <button
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-xs font-black transition",
        active
          ? "bg-[#eff6ff] text-[#2563eb] dark:bg-[#172554] dark:text-[#93c5fd]"
          : "text-[#344054] hover:bg-[#f8fafc] dark:text-[#cbd5e1] dark:hover:bg-white/10",
        className,
      )}
      type="button"
      {...props}
    >
      <span className="truncate">{children}</span>
      {badge !== undefined && badge !== null ? (
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-[#2563eb] ring-1 ring-[#bfdbfe] dark:bg-white/10 dark:text-[#93c5fd] dark:ring-white/10">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function ConsoleChoiceButton({
  className,
  description,
  icon: Icon,
  label,
  selected = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  description?: ReactNode;
  icon: LucideIcon;
  label: ReactNode;
  selected?: boolean;
}) {
  return (
    <button
      aria-pressed={props.role ? undefined : selected}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left transition",
        selected
          ? "border-[#2563eb] bg-[#eef4ff] text-[#1d4ed8] ring-4 ring-[#2563eb]/10 dark:border-[#3b82f6] dark:bg-[#172554] dark:text-[#93c5fd]"
          : "border-[#d9e0eb] bg-white text-[#344054] hover:border-[#9db7f2] dark:border-white/10 dark:bg-[#0b1220] dark:text-[#cbd5e1] dark:hover:border-[#3b82f6]",
        className,
      )}
      type="button"
      {...props}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black">{label}</span>
        {description ? (
          <span className="block text-xs font-bold leading-5 text-[#667085] dark:text-[#98a2b3]">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
