import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Network } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { listVpcs, withCloudResult } from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

export default async function VpcDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    async (session) =>
      (await listVpcs(session)).find((vpc) => vpc.id === id) ?? null,
    `vpc:${id}`,
  );
  const item = result.data;
  if (!item) notFound();
  return <NetworkDetail activeTitle="VPC" back="/services/network" facts={[["Name", item.name], ["ID", item.id], ["CIDR", item.cidr], ["Status", item.status]]} icon={<Network className="size-6" />} isCached={result.isCached} isRefreshing={result.isRefreshing} title={item.name} updatedAt={result.updatedAt} />;
}

function NetworkDetail({ activeTitle, back, facts, icon, isCached, isRefreshing, title, updatedAt }: { activeTitle: string; back: string; facts: string[][]; icon: React.ReactNode; isCached: boolean; isRefreshing: boolean; title: string; updatedAt: string }) {
  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]" href={back}><ArrowLeft className="size-4" />Back to Networking</Link>
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">{icon}</div><div><p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">{activeTitle}</p><h1 className="mt-1 text-3xl font-black tracking-tight">{title}</h1><p className="mt-1 text-xs font-bold text-[#98a2b3]">Showing {isCached ? "cached" : "fresh"} data from <LocalDateTime value={updatedAt} />.</p></div></div><RefreshButton /></div></section>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{facts.map(([label, value]) => <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]" key={label}><p className="text-sm font-bold text-[#667085]">{label}</p><p className="mt-2 break-words text-lg font-black">{value}</p></article>)}</section>
      </main>
    </ConsoleShell>
  );
}
