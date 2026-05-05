import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  DatabaseBackup,
  Gauge,
  HardDrive,
  Link2,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const details = [
  ["Name", "evs-prod-api-data"],
  ["Type", "Ultra-high I/O"],
  ["Capacity", "500 GB"],
  ["Availability zone", "sa-brazil-1a"],
  ["Created", "April 28, 2026, 10:03"],
  ["Enterprise project", "Acme Project"],
];

const attachment = [
  ["Attached ECS", "ecs-prod-api-01"],
  ["Device name", "/dev/vdb"],
  ["Attachment mode", "Read/write"],
  ["Private IP", "10.24.8.41"],
];

const protection = [
  ["Encryption", "Enabled", LockKeyhole],
  ["Backup policy", "ecs-prod-daily", DatabaseBackup],
  ["Last snapshot", "May 3, 2026, 02:00", CheckCircle2],
  ["Security posture", "Healthy", ShieldCheck],
] as const;

export default async function EvsDiskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ConsoleShell active="Storage">
      <main className="grid gap-6 p-4 lg:p-8">
      <Link
        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
        href="/services/evs"
      >
        <ArrowLeft className="size-4" />
        Back to EVS
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eaf2ff] text-[#2563eb]">
                <HardDrive className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">
                    evs-prod-api-data
                  </h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    In-use
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  {id} · Elastic Volume Service
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                ["Attach", Link2],
                ["Create snapshot", DatabaseBackup],
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

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Provisioned IOPS", "5,800", Zap, "text-[#2563eb]"],
            ["Throughput", "180 MB/s", Gauge, "text-[#16a34a]"],
            ["Attached server", "ecs-prod-api-01", Server, "text-[#9333ea]"],
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
              <h2 className="text-lg font-black">Disk properties</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {details.map(([label, value]) => (
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
              <h2 className="text-lg font-black">Attachment</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {attachment.map(([label, value]) => (
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
              <h2 className="text-lg font-black">Protection</h2>
              <div className="mt-5 divide-y divide-[#e4e9f2]">
                {protection.map(([label, value, Icon]) => (
                  <div
                    className="flex items-center justify-between gap-4 py-3"
                    key={label}
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#475467]">
                      <Icon className="size-5 text-[#2563eb]" />
                      {label}
                    </span>
                    <span className="text-right text-sm font-black">
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
