import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Database } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { getRdsInstance, withCloudResult } from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

export default async function RdsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getRdsInstance(session, id),
    `rds-instance:${id}`,
  );
  const instance = result.data;
  if (!instance) notFound();

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/rds"><ArrowLeft className="size-4" />Back to RDS</Link>
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]"><Database className="size-6" /></div><div><p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">RDS instance</p><h1 className="mt-1 text-3xl font-black tracking-tight">{instance.name}</h1><p className="mt-1 text-sm font-semibold text-[#667085]">{instance.id}</p><p className="mt-1 text-xs font-bold text-[#98a2b3]">Showing {result.isCached ? "cached" : "fresh"} data from <LocalDateTime value={result.updatedAt} />.</p></div></div><RefreshButton /></div>
        </section>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[["Status", instance.status], ["Datastore", instance.datastore], ["Private IP", instance.privateIp], ["Type", instance.type]].map(([label, value]) => <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]" key={label}><p className="text-sm font-bold text-[#667085]">{label}</p><p className="mt-2 break-words text-lg font-black">{value}</p></article>)}
        </section>
      </main>
    </ConsoleShell>
  );
}
