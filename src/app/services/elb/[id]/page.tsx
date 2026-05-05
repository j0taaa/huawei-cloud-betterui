import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CloudCog,
  Globe2,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const listeners = [
  ["HTTPS 443", "Forward to pool-commerce-web", "TLS enabled", "Healthy"],
  ["HTTP 80", "Redirect to HTTPS", "No certificate", "Healthy"],
  ["TCP 8080", "Forward to pool-api-private", "Internal", "Healthy"],
];

const backends = [
  ["ecs-prod-web-01", "10.24.8.51", "Healthy", "18 ms"],
  ["ecs-prod-web-02", "10.24.8.62", "Healthy", "21 ms"],
  ["ecs-prod-api-01", "10.24.8.41", "Healthy", "16 ms"],
];

export default async function ElbDetailPage({
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
        href="/services/elb"
      >
        <ArrowLeft className="size-4" />
        Back to ELB
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <CloudCog className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">{id}</h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    Healthy
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  Elastic Load Balance · vpc-commerce-core · 177.92.14.80
                </p>
              </div>
            </div>

            <button className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold shadow-sm hover:bg-[#f8fafc]">
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Listeners", "6", Network, "text-[#2563eb]"],
            ["Backends", "18", Server, "text-[#16a34a]"],
            ["Traffic today", "420 GB", Activity, "text-[#9333ea]"],
            ["TLS certificates", "3", ShieldCheck, "text-[#f97316]"],
          ].map(([label, value, Icon, color]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label as string}
            >
              <Icon className={`size-5 ${color}`} />
              <p className="mt-4 text-sm font-bold text-[#667085]">
                {label as string}
              </p>
              <p className="mt-1 text-2xl font-black">{value as string}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <ResourceTable
            headers={["Listener", "Action", "TLS", "Status"]}
            rows={listeners}
            title="Listeners"
          />
          <ResourceTable
            headers={["Backend", "IP", "Status", "Latency"]}
            rows={backends}
            title="Backend servers"
          />
        </section>

        <section className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4">
            <CheckCircle2 className="size-5 text-[#16a34a]" />
            <p className="text-sm font-bold">
              Health checks are passing for all production backend pools.
            </p>
            <Globe2 className="ml-auto size-5 text-[#2563eb]" />
          </div>
        </section>
      </div>
      </main>
    </ConsoleShell>
  );
}

function ResourceTable({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: string[][];
  title: string;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
      <div className="border-b border-[#e4e9f2] p-5">
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
          <tr>
            {headers.map((header) => (
              <th className="px-5 py-3" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e4e9f2]">
          {rows.map((row) => (
            <tr className="hover:bg-[#fbfcfe]" key={row.join("-")}>
              {row.map((cell) => (
                <td className="px-5 py-4 font-semibold" key={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
