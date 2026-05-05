import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  GitBranch,
  Layers3,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const clusterDetails = [
  ["Kubernetes version", "v1.29.4-r0"],
  ["Cluster flavor", "Turbo"],
  ["Network model", "VPC-native"],
  ["Container network", "10.42.0.0/16"],
  ["Service network", "10.43.0.0/16"],
  ["Created", "April 12, 2026, 11:20"],
];

const nodePools = [
  ["pool-system", "6 nodes", "c7.large.4", "Ready"],
  ["pool-apps", "18 nodes", "c7.xlarge.4", "Ready"],
  ["pool-jobs", "4 nodes", "s6.large.2", "Scaling"],
];

const addOns = [
  ["CoreDNS", "Running", Network],
  ["Everest CSI", "Running", Database],
  ["Cloud Native Logging", "Running", TerminalSquare],
  ["Volcano Scheduler", "Running", Cpu],
] as const;

export default async function CceClusterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ConsoleShell active="Compute">
      <main className="grid gap-6 p-4 lg:p-8">
      <Link
        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
        href="/services/cce"
      >
        <ArrowLeft className="size-4" />
        Back to CCE
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Layers3 className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">{id}</h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    Running
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  Cloud Container Engine · AL-São Paulo1
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                ["Kubectl", TerminalSquare],
                ["Scale", Server],
                ["Refresh", RefreshCw],
              ].map(([label, Icon]) => (
                <button
                  className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold shadow-sm hover:bg-[#f8fafc]"
                  key={label as string}
                >
                  <Icon className="size-4" />
                  {label as string}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Nodes", "24", Server, "text-[#2563eb]"],
            ["Workloads", "186", GitBranch, "text-[#16a34a]"],
            ["CPU requested", "68%", Cpu, "text-[#9333ea]"],
            ["Policy checks", "Healthy", ShieldCheck, "text-[#f97316]"],
          ].map(([label, value, Icon, color]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label as string}
            >
              <div className="grid size-11 place-items-center rounded-full bg-[#f7f9fc]">
                <Icon className={`size-5 ${color}`} />
              </div>
              <p className="mt-5 text-sm font-bold text-[#344054]">
                {label as string}
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight">
                {value as string}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Cluster configuration</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {clusterDetails.map(([label, value]) => (
                  <div className="rounded-lg bg-[#fbfcfe] p-4" key={label}>
                    <p className="text-xs font-black uppercase tracking-wide text-[#667085]">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="border-b border-[#e4e9f2] p-5">
                <h2 className="text-lg font-black">Node pools</h2>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Nodes</th>
                    <th className="px-5 py-3">Flavor</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e9f2]">
                  {nodePools.map(([name, nodes, flavor, status]) => (
                    <tr className="hover:bg-[#fbfcfe]" key={name}>
                      <td className="px-5 py-4 font-black">{name}</td>
                      <td className="px-5 py-4 font-semibold">{nodes}</td>
                      <td className="px-5 py-4 font-semibold">{flavor}</td>
                      <td className="px-5 py-4 text-[#667085]">{status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>

          <aside className="grid content-start gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Add-ons</h2>
              <div className="mt-5 divide-y divide-[#e4e9f2]">
                {addOns.map(([label, value, Icon]) => (
                  <div
                    className="flex items-center justify-between gap-4 py-3"
                    key={label}
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#475467]">
                      <Icon className="size-5 text-[#2563eb]" />
                      {label}
                    </span>
                    <span className="flex items-center gap-2 text-sm font-black text-[#15803d]">
                      <CheckCircle2 className="size-4" />
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </aside>
        </section>
      </div>
      </main>
    </ConsoleShell>
  );
}
