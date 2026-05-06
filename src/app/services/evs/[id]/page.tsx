import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, HardDrive } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { getCurrentSession } from "@/lib/auth-session";
import { getEvsDisk } from "@/lib/huawei-cloud";

export default async function EvsDiskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentSession();
  const { id } = await params;

  if (!session) notFound();

  const disk = await getEvsDisk(session, id).catch(() => null);
  if (!disk) notFound();

  return (
    <ConsoleShell active="Storage">
      <main className="grid gap-6 p-4 lg:p-8">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/evs">
          <ArrowLeft className="size-4" />
          Back to EVS
        </Link>
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]"><HardDrive className="size-6" /></div>
              <div><p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">EVS disk</p><h1 className="mt-1 text-3xl font-black tracking-tight">{disk.name}</h1><p className="mt-1 text-sm font-semibold text-[#667085]">{disk.id}</p></div>
            </div>
            <RefreshButton />
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[["Status", disk.status], ["Size", disk.size], ["Type", disk.type], ["Attached to", disk.attachedTo], ["Availability Zone", disk.availabilityZone], ["Created", disk.createdAt]].map(([label, value]) => (
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]" key={label}>
              <p className="text-sm font-bold text-[#667085]">{label}</p>
              <p className="mt-2 break-words text-lg font-black">{value}</p>
            </article>
          ))}
        </section>
      </main>
    </ConsoleShell>
  );
}
