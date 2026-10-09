import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ConsoleCodeBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto rounded-xl border border-[#d9e0eb] bg-[#f8fafc] p-4 font-mono text-xs leading-5 text-[#344054] dark:border-white/10 dark:bg-white/5 dark:text-[#e2e8f0]",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function ConsoleLogEntry({
  children,
  className,
  labels,
}: {
  children: ReactNode;
  className?: string;
  labels?: Array<{ label: ReactNode; value: ReactNode }>;
}) {
  return (
    <article
      className={cn(
        "rounded-lg border border-[#e4e9f2] bg-white p-3 dark:border-white/10 dark:bg-[#0b1220]",
        className,
      )}
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[#101828] dark:text-[#e2e8f0]">
        {children}
      </pre>
      {labels?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {labels.map((item, index) => (
            <span
              className="rounded-full bg-[#eef4ff] px-2 py-1 text-[11px] font-black text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]"
              key={index}
            >
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
