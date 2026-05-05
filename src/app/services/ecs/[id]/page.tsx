import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  KeyRound,
  Network,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  TerminalSquare,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const detailRows = [
  ["Flavor", "c7.large.4"],
  ["Image", "Huawei Cloud EulerOS 2.0"],
  ["Availability zone", "sa-brazil-1a"],
  ["Created", "April 28, 2026, 09:42"],
  ["Billing mode", "Yearly/Monthly"],
  ["Enterprise project", "Acme Project"],
];

const networkRows = [
  ["VPC", "vpc-commerce-core"],
  ["Subnet", "subnet-prod-api"],
  ["Private IP", "10.24.8.41"],
  ["Public EIP", "177.92.14.18"],
  ["Security group", "sg-prod-web"],
  ["Bandwidth", "50 Mbit/s"],
];

const storageRows = [
  ["System disk", "80 GB High I/O"],
  ["Data disk", "500 GB Ultra-high I/O"],
  ["Backup policy", "ecs-prod-daily"],
  ["Last backup", "May 3, 2026, 02:00"],
];

const metrics = [
  ["CPU", "31%", Cpu, "text-[#2563eb]"],
  ["Memory", "58%", Database, "text-[#16a34a]"],
  ["Disk read", "4.08 KB/s", HardDrive, "text-[#9333ea]"],
  ["Network in", "0 Kbit/s", Network, "text-[#f97316]"],
] as const;

const events = [
  ["Instance started", "2 minutes ago", CheckCircle2, "text-[#16a34a]"],
  ["Security group sg-prod-web attached", "24 minutes ago", ShieldCheck, "text-[#2563eb]"],
  ["Daily backup completed", "6 hours ago", HardDrive, "text-[#9333ea]"],
] as const;

export default async function EcsInstancePage({
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
        href="/services/ecs"
      >
        <ArrowLeft className="size-4" />
        Back to ECS
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eaf2ff] text-[#2563eb]">
                <Server className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">
                    ecs-prod-api-01
                  </h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    Running
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  {id} · Elastic Cloud Server · AL-São Paulo1
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                ["Remote login", TerminalSquare],
                ["Restart", RefreshCw],
                ["Stop", Square],
                ["Start", Play],
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map(([label, value, Icon, color]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label}
            >
              <div className="flex items-center justify-between">
                <div className="grid size-11 place-items-center rounded-full bg-[#f7f9fc]">
                  <Icon className={`size-5 ${color}`} />
                </div>
                <Activity className="size-4 text-[#98a2b3]" />
              </div>
              <p className="mt-5 text-sm font-bold text-[#344054]">{label}</p>
              <p className="mt-1 text-3xl font-black tracking-tight">{value}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Configuration</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {detailRows.map(([label, value]) => (
                  <div className="rounded-lg bg-[#fbfcfe] p-4" key={label}>
                    <p className="text-xs font-black uppercase tracking-wide text-[#667085]">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Networking</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {networkRows.map(([label, value]) => (
                  <div className="rounded-lg bg-[#fbfcfe] p-4" key={label}>
                    <p className="text-xs font-black uppercase tracking-wide text-[#667085]">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <aside className="grid content-start gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Storage and backup</h2>
              <div className="mt-5 divide-y divide-[#e4e9f2]">
                {storageRows.map(([label, value]) => (
                  <div className="py-3" key={label}>
                    <p className="text-xs font-black uppercase tracking-wide text-[#667085]">
                      {label}
                    </p>
                    <p className="mt-1 text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Access and security</h2>
              <div className="mt-5 grid gap-3">
                <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-3">
                  <KeyRound className="size-5 text-[#2563eb]" />
                  <span className="text-sm font-bold">Key pair: acme-prod</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-3">
                  <ShieldCheck className="size-5 text-[#16a34a]" />
                  <span className="text-sm font-bold">
                    Security posture: healthy
                  </span>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-3">
                  <Globe2 className="size-5 text-[#f97316]" />
                  <span className="text-sm font-bold">
                    Public access: EIP bound
                  </span>
                </div>
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Recent events</h2>
              <div className="mt-5 grid gap-4">
                {events.map(([label, time, Icon, color]) => (
                  <div className="flex gap-3" key={label}>
                    <Icon className={`mt-0.5 size-5 ${color}`} />
                    <div>
                      <p className="text-sm font-bold">{label}</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        {time}
                      </p>
                    </div>
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
