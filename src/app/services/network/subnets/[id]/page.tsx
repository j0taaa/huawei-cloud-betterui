import { mapCloudLoad } from "@/lib/huawei/errors";
import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Route } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { listSubnets, withCloudResult } from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

export default async function SubnetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => mapCloudLoad(() => listSubnets(session), (items) => items.find((subnet) => subnet.id === id) ?? null),
    cloudCacheKeys.subnet(id),
  );
  if (!result.data && result.error) return <CloudErrorPage active="Networking" backHref="/services/network" error={result.error} />;
  const item = result.data;
  if (!item) notFound();
  const facts = [["Name", item.name], ["ID", item.id], ["CIDR", item.cidr], ["Gateway", item.gateway], ["VPC ID", item.vpcId], ["Status", item.status]];
  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <CloudErrorBanner error={result.error} isCached={result.isCached} />
      <main className="grid gap-6 p-4 lg:p-8">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/network"><ArrowLeft className="size-4" />Back to Networking</Link>
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]"><Route className="size-6" /></div><div><p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">Subnet</p><h1 className="mt-1 text-3xl font-black tracking-tight">{item.name}</h1><p className="mt-1 text-xs font-bold text-[#98a2b3]">Showing {result.isCached ? "cached" : "fresh"} data from <LocalDateTime value={result.updatedAt} />.</p></div></div><RefreshButton /></div></section>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{facts.map(([label, value]) => <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]" key={label}><p className="text-sm font-bold text-[#667085]">{label}</p><p className="mt-2 break-words text-lg font-black">{value}</p></article>)}</section>
      </main>
    </ConsoleShell>
  );
}
