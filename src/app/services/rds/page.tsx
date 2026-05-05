import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Database,
  DatabaseBackup,
  Gauge,
  HardDrive,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import { ServiceCommandSearch } from "@/components/service-command-search";

export const metadata: Metadata = {
  title: "RDS | Huawei Cloud Better UI",
  description: "Relational Database Service management page.",
};

const stats = [
  ["Instances", "12", "10 available", Database, "text-[#2563eb]"],
  ["Storage used", "3.4 TB", "61% allocated", HardDrive, "text-[#16a34a]"],
  ["Backups", "84", "7 retained weekly", DatabaseBackup, "text-[#9333ea]"],
  ["Slow queries", "18", "2 need review", Zap, "text-[#f97316]"],
] as const;

const instances = [
  {
    id: "rds-orders-primary",
    name: "rds-orders-primary",
    engine: "PostgreSQL 15",
    status: "Available",
    flavor: "rds.pg.c6.xlarge",
    storage: "800 GB",
    connections: "184",
    cpu: "42%",
    role: "Primary",
  },
  {
    id: "rds-users-primary",
    name: "rds-users-primary",
    engine: "MySQL 8.0",
    status: "Available",
    flavor: "rds.mysql.c6.large",
    storage: "420 GB",
    connections: "96",
    cpu: "31%",
    role: "Primary",
  },
  {
    id: "rds-analytics-replica",
    name: "rds-analytics-replica",
    engine: "PostgreSQL 14",
    status: "Scaling",
    flavor: "rds.pg.c6.2xlarge",
    storage: "1.2 TB",
    connections: "64",
    cpu: "67%",
    role: "Read replica",
  },
];

const actions = [
  ["Create instance", Plus, "bg-[#2563eb] text-white"],
  ["Create backup", DatabaseBackup, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const statusClasses = {
  Available: "bg-[#e9f8f1] text-[#15803d]",
  Scaling: "bg-[#fff7ed] text-[#c2410c]",
};

const postureRows = [
  ["Automated backups", "Enabled on all", DatabaseBackup],
  ["Encryption", "11 encrypted", ShieldCheck],
  ["Performance insights", "8 enabled", Gauge],
  ["Maintenance windows", "3 upcoming", RefreshCw],
] as const;

export default function RdsPage() {
  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active="Databases" />
        <CloudSidebarInset>
          <header className="sticky top-0 z-20 border-b border-[#e4e9f2] bg-white/90 backdrop-blur-xl">
            <div className="flex min-h-20 flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <Cloud className="size-4 text-[#2563eb]" />
                  Acme Project
                  <ChevronDown className="size-4 text-[#667085]" />
                </button>
                <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <MapPin className="size-4 text-[#d7000f]" />
                  AL-São Paulo1
                  <ChevronDown className="size-4 text-[#667085]" />
                </button>
              </div>
              <ServiceCommandSearch />
              <div className="flex items-center gap-4">
                <button aria-label="Notifications" className="relative">
                  <Bell className="size-5" />
                  <span className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-[#d7000f] text-[10px] font-bold text-white">
                    3
                  </span>
                </button>
                <CircleHelp className="size-5 text-[#475467]" />
                <div className="hidden items-center gap-3 border-l border-[#e4e9f2] pl-4 sm:flex">
                  <div className="grid size-10 place-items-center rounded-full bg-[#f0f3f8]">
                    <UserRound className="size-5 text-[#667085]" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold">g50047609</p>
                    <p className="text-xs font-semibold text-[#667085]">
                      Intl-Português
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="grid gap-6 p-4 lg:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <Link
                  className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
                  href="/"
                >
                  <ArrowLeft className="size-4" />
                  Back to dashboard
                </Link>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                    <Database className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Relational Database Service
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage database instances, replicas, backups, parameters,
                      and performance.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {actions.map(([label, Icon, className]) => (
                  <button
                    className={`flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold shadow-sm ${className}`}
                    key={label}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {stats.map(([label, value, detail, Icon, color]) => (
                <article
                  className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
                  key={label}
                >
                  <div className="flex items-center justify-between">
                    <div className="grid size-12 place-items-center rounded-full bg-[#f7f9fc]">
                      <Icon className={`size-6 ${color}`} />
                    </div>
                    <CheckCircle2 className="size-5 text-[#16a34a]" />
                  </div>
                  <p className="mt-5 text-sm font-bold text-[#344054]">
                    {label}
                  </p>
                  <p className="mt-1 text-3xl font-black tracking-tight">
                    {value}
                  </p>
                  <p className="mt-3 text-sm font-medium text-[#667085]">
                    {detail}
                  </p>
                </article>
              ))}
            </section>

            <section className="grid gap-6 2xl:grid-cols-[1fr_360px]">
              <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
                <div className="flex flex-col gap-4 border-b border-[#e4e9f2] p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-black">Database instances</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Managed relational databases for the selected project.
                    </p>
                  </div>
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                    <Search className="size-4" />
                    <input
                      aria-label="Search RDS instances"
                      className="w-48 bg-transparent outline-none"
                      placeholder="Search databases"
                    />
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Instance</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Engine</th>
                        <th className="px-5 py-3">Flavor</th>
                        <th className="px-5 py-3">Storage</th>
                        <th className="px-5 py-3">Connections</th>
                        <th className="px-5 py-3">CPU</th>
                        <th className="px-5 py-3">Role</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {instances.map((instance) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={instance.id}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${instance.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/rds/${instance.id}`}
                            />
                            <div className="font-black">{instance.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              AL-São Paulo1
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                statusClasses[
                                  instance.status as keyof typeof statusClasses
                                ]
                              }`}
                            >
                              {instance.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {instance.engine}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {instance.flavor}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {instance.storage}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {instance.connections}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {instance.cpu}
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {instance.role}
                          </td>
                          <td className="px-5 py-4">
                            <button
                              aria-label="More actions"
                              className="relative z-20"
                            >
                              <MoreHorizontal className="size-5 text-[#667085]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <aside className="grid content-start gap-6">
                <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
                  <h2 className="text-lg font-black">Database posture</h2>
                  <div className="mt-5 divide-y divide-[#e4e9f2]">
                    {postureRows.map(([label, value, Icon]) => (
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
          </main>
        </CloudSidebarInset>
      </div>
    </CloudSidebarProvider>
  );
}
