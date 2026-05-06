import Link from "next/link";
import { ArrowLeft, Box, KeyRound } from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

export default async function ObsBucketPage({
  params,
}: {
  params: Promise<{ bucket: string }>;
}) {
  const { bucket } = await params;

  return (
    <ConsoleShell active="Storage">
      <main className="grid gap-6 p-4 lg:p-8">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/obs">
          <ArrowLeft className="size-4" />
          Back to OBS
        </Link>
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
              <Box className="size-6" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">OBS bucket</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">{bucket}</h1>
            </div>
          </div>
        </section>
        <section className="rounded-xl border border-[#dbe7ff] bg-[#f5f8ff] p-6">
          <div className="flex gap-4">
            <KeyRound className="mt-1 size-6 shrink-0 text-[#2563eb]" />
            <p className="text-sm font-semibold leading-6 text-[#475467]">
              Real object browsing is not shown yet because OBS requires
              signed AK/SK or temporary AK/SK requests. This page intentionally
              avoids showing placeholder folders or files as if they came from
              your account.
            </p>
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}
