import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  DatabaseBackup,
  Gauge,
  HardDrive,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const configuration = [
  ["Engine", "PostgreSQL 15"],
  ["Flavor", "rds.pg.c6.xlarge"],
  ["Storage", "800 GB SSD"],
  ["Availability", "Primary + standby"],
  ["Private endpoint", "10.24.12.30:5432"],
  ["Maintenance window", "Sunday 02:00-03:00"],
];

const backups = [
  ["Automated backup", "Enabled", "02:00 daily"],
  ["Retention", "14 days", "84 restore points"],
  ["Latest backup", "May 3, 2026", "Completed"],
];

const events = [
  ["Backup completed", "6 hours ago"],
  ["Parameter group applied", "1 day ago"],
  ["Read replica promoted for test", "4 days ago"],
];

export default async function RdsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ConsoleShell active="Databases">
      <main className="grid gap-6 p-4 lg:p-8">
      <Link
        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
        href="/services/rds"
      >
        <ArrowLeft className="size-4" />
        Back to RDS
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Database className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">{id}</h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    Available
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  Relational Database Service · AL-São Paulo1
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
            ["CPU", "42%", Gauge, "text-[#2563eb]"],
            ["Connections", "184", Zap, "text-[#16a34a]"],
            ["Storage", "512 / 800 GB", HardDrive, "text-[#9333ea]"],
            ["Backups", "Healthy", DatabaseBackup, "text-[#f97316]"],
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

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Configuration</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {configuration.map(([label, value]) => (
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
                <h2 className="text-lg font-black">Backup policy</h2>
              </div>
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-[#e4e9f2]">
                  {backups.map(([label, value, detail]) => (
                    <tr className="hover:bg-[#fbfcfe]" key={label}>
                      <td className="px-5 py-4 font-black">{label}</td>
                      <td className="px-5 py-4 font-semibold">{value}</td>
                      <td className="px-5 py-4 text-[#667085]">{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>

          <aside className="grid content-start gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Security</h2>
              <div className="mt-5 grid gap-3">
                <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-3">
                  <LockKeyhole className="size-5 text-[#2563eb]" />
                  <span className="text-sm font-bold">SSL required</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-3">
                  <ShieldCheck className="size-5 text-[#16a34a]" />
                  <span className="text-sm font-bold">Encryption enabled</span>
                </div>
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Recent events</h2>
              <div className="mt-5 grid gap-4">
                {events.map(([label, time]) => (
                  <div className="flex gap-3" key={label}>
                    <CheckCircle2 className="mt-0.5 size-5 text-[#16a34a]" />
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
