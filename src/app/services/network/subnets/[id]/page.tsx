import Link from "next/link";
import { ArrowLeft, CheckCircle2, Network, Route } from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

export default async function SubnetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
          <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
            <Route className="size-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">{id}</h1>
            <p className="mt-1 text-sm font-semibold text-[#667085]">
              Subnet · vpc-commerce-core · 10.24.8.0/24
            </p>
          </div>
        </div>
      </section>
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["Gateway", "10.24.8.1", Network],
          ["Used IPs", "186", Route],
          ["Available IPs", "67", CheckCircle2],
        ].map(([label, value, Icon]) => (
          <article
            className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
            key={label as string}
          >
            <Icon className="size-5 text-[#2563eb]" />
            <p className="mt-4 text-sm font-bold text-[#667085]">
              {label as string}
            </p>
            <p className="mt-1 text-2xl font-black">{value as string}</p>
          </article>
        ))}
      </section>
      </main>
    </ConsoleShell>
  );
}
