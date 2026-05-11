import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Server } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { EcsInstanceActions } from "@/components/ecs-instance-actions";
import { getCurrentSession } from "@/lib/auth-session";
import { getEcsInstance } from "@/lib/huawei-cloud";

export default async function EcsInstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentSession();
  const { id } = await params;

  if (!session) {
    notFound();
  }

  const instance = await getEcsInstance(session, id).catch(() => null);

  if (!instance) {
    notFound();
  }

  return (
    <ConsoleShell active="Compute">
      <main className="grid gap-6 p-4 lg:p-8">
        <Link
          className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]"
          href="/services/ecs"
        >
          <ArrowLeft className="size-4" />
          Back to ECS
        </Link>

        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eaf2ff] text-[#2563eb]">
                <Server className="size-6" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">
                  ECS instance
                </p>
                <h1 className="mt-1 text-3xl font-black tracking-tight">
                  {instance.name}
                </h1>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  {instance.id}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <EcsInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
              />
              <RefreshButton />
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["Status", instance.status],
            ["Flavor", instance.flavor],
            ["Image", instance.image],
            ["Private IP", instance.privateIp],
            ["Public IP", instance.publicIp],
            ["Availability Zone", instance.availabilityZone],
            ["Created", instance.createdAt],
          ].map(([label, value]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label}
            >
              <p className="text-sm font-bold text-[#667085]">{label}</p>
              <p className="mt-2 break-words text-lg font-black">{value}</p>
            </article>
          ))}
        </section>
      </main>
    </ConsoleShell>
  );
}
