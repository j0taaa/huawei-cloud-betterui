import Link from "next/link";
import type { ComponentProps } from "react";
import { RefreshButton } from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";

export function CloudErrorBanner({
  error,
  isCached = false,
}: {
  error: string | null;
  isCached?: boolean;
}) {
  if (!error) return null;
  return (
    <section
      role="alert"
      className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]"
    >
      <p>
        {isCached
          ? "Showing the last successful data. Refresh failed."
          : "Some cloud data could not be loaded."}
      </p>
      <p className="mt-2 break-words">{error}</p>
    </section>
  );
}

export function CloudErrorPage({
  active,
  backHref,
  error,
}: {
  active: ComponentProps<typeof ConsoleShell>["active"];
  backHref: string;
  error: string;
}) {
  return (
    <ConsoleShell active={active}>
      <main className="grid gap-6 p-4 lg:p-8">
        <Link className="text-sm font-bold text-[#2563eb]" href={backHref}>
          Back to resources
        </Link>
        <h1 className="text-3xl font-black">Unable to load resource</h1>
        <CloudErrorBanner error={error} />
        <div>
          <RefreshButton />
        </div>
      </main>
    </ConsoleShell>
  );
}
