import Link from "next/link";
import { ArrowLeft, CheckCircle2, Globe2, Network, Route, ShieldCheck } from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

export default async function VpcDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <NetworkDetail id={id} title="VPC" icon={Network} />;
}

function NetworkDetail({
  id,
  title,
  icon: Icon,
}: {
  id: string;
  title: string;
  icon: typeof Network;
}) {
  return (
    <ConsoleShell active="Networking">
      <main className="grid gap-6 p-4 lg:p-8">
      <Link
        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
        href="/services/network"
      >
        <ArrowLeft className="size-4" />
        Back to Networking
      </Link>
      <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="flex items-center gap-4">
          <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
            <Icon className="size-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">{id}</h1>
            <p className="mt-1 text-sm font-semibold text-[#667085]">
              {title} · AL-São Paulo1
            </p>
          </div>
        </div>
      </section>
      <section className="mt-6 grid gap-4 md:grid-cols-4">
        {[
          ["CIDR", "10.24.0.0/16", Network],
          ["Subnets", "8", Route],
          ["Security groups", "12", ShieldCheck],
          ["EIPs", "4", Globe2],
        ].map(([label, value, CardIcon]) => (
          <article
            className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
            key={label as string}
          >
            <CardIcon className="size-5 text-[#2563eb]" />
            <p className="mt-4 text-sm font-bold text-[#667085]">
              {label as string}
            </p>
            <p className="mt-1 text-2xl font-black">{value as string}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <h2 className="text-lg font-black">Health</h2>
        <div className="mt-5 flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4">
          <CheckCircle2 className="size-5 text-[#16a34a]" />
          <p className="text-sm font-bold">
            Routes, subnets, and attached security groups are operational.
          </p>
        </div>
      </section>
      </main>
    </ConsoleShell>
  );
}
