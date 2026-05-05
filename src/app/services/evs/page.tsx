import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  DatabaseBackup,
  Gauge,
  HardDrive,
  Link2,
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
  title: "EVS | Huawei Cloud Better UI",
  description: "Elastic Volume Service management page.",
};

const stats = [
  ["Disks", "18", "14 attached", HardDrive, "text-[#2563eb]"],
  ["Provisioned capacity", "6.8 TB", "72% in production", Gauge, "text-[#16a34a]"],
  ["Snapshots", "46", "12 created this week", DatabaseBackup, "text-[#9333ea]"],
  ["Encrypted disks", "16", "2 need review", ShieldCheck, "text-[#f97316]"],
] as const;

const disks = [
  {
    id: "evs-0f42a7c1",
    name: "evs-prod-api-system",
    status: "In-use",
    type: "High I/O",
    size: "80 GB",
    attachedTo: "ecs-prod-api-01",
    iops: "1,420",
    encrypted: "Yes",
    zone: "sa-brazil-1a",
  },
  {
    id: "evs-62e91db4",
    name: "evs-prod-api-data",
    status: "In-use",
    type: "Ultra-high I/O",
    size: "500 GB",
    attachedTo: "ecs-prod-api-01",
    iops: "5,800",
    encrypted: "Yes",
    zone: "sa-brazil-1a",
  },
  {
    id: "evs-90cc17a8",
    name: "evs-worker-cache",
    status: "In-use",
    type: "General Purpose SSD",
    size: "1 TB",
    attachedTo: "ecs-worker-12",
    iops: "3,120",
    encrypted: "No",
    zone: "sa-brazil-1b",
  },
  {
    id: "evs-b7713e20",
    name: "evs-staging-spare",
    status: "Available",
    type: "High I/O",
    size: "200 GB",
    attachedTo: "-",
    iops: "0",
    encrypted: "Yes",
    zone: "sa-brazil-1a",
  },
];

const actions = [
  ["Create disk", Plus, "bg-[#2563eb] text-white"],
  ["Attach disk", Link2, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const statusClasses = {
  "In-use": "bg-[#e9f8f1] text-[#15803d]",
  Available: "bg-[#eef4ff] text-[#2563eb]",
};

const postureRows = [
  ["Backup coverage", "14 of 18 disks", DatabaseBackup],
  ["Encryption", "16 encrypted", ShieldCheck],
  ["Performance alerts", "1 active", Zap],
  ["Attachment health", "All attached disks healthy", Link2],
] as const;

export default function EvsPage() {
  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active="Storage" />
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
                  <div className="grid size-12 place-items-center rounded-xl bg-[#eaf2ff] text-[#2563eb]">
                    <HardDrive className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Elastic Volume Service
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage block storage disks, attachments, snapshots, and
                      encryption.
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
                    <h2 className="text-lg font-black">Disks</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      EVS disk inventory for the selected project and region.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                      <Search className="size-4" />
                      <input
                        aria-label="Search EVS disks"
                        className="w-48 bg-transparent outline-none"
                        placeholder="Search disks"
                      />
                    </label>
                    <button className="h-10 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold">
                      Status: All
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Disk</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Type</th>
                        <th className="px-5 py-3">Size</th>
                        <th className="px-5 py-3">Attached to</th>
                        <th className="px-5 py-3">IOPS</th>
                        <th className="px-5 py-3">Encrypted</th>
                        <th className="px-5 py-3">AZ</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {disks.map((disk) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={disk.id}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${disk.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/evs/${disk.id}`}
                            />
                            <div className="font-black">{disk.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              {disk.id}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                statusClasses[
                                  disk.status as keyof typeof statusClasses
                                ]
                              }`}
                            >
                              {disk.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {disk.type}
                          </td>
                          <td className="px-5 py-4 font-bold">{disk.size}</td>
                          <td className="px-5 py-4 font-semibold">
                            {disk.attachedTo}
                          </td>
                          <td className="px-5 py-4 font-bold">{disk.iops}</td>
                          <td className="px-5 py-4 text-[#667085]">
                            {disk.encrypted}
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {disk.zone}
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
                  <h2 className="text-lg font-black">Storage posture</h2>
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

                <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
                  <h2 className="text-lg font-black">IOPS trend</h2>
                  <div className="mt-5 rounded-lg bg-[#fbfcfe] p-4">
                    <svg className="h-40 w-full" viewBox="0 0 280 140">
                      <polyline
                        fill="none"
                        points="0,92 28,80 56,84 84,64 112,72 140,54 168,68 196,48 224,62 252,38 280,52"
                        stroke="#2563eb"
                        strokeWidth="4"
                      />
                      <polyline
                        fill="none"
                        points="0,110 28,102 56,96 84,88 112,82 140,74 168,70 196,64 224,58 252,54 280,48"
                        stroke="#16a34a"
                        strokeWidth="4"
                      />
                    </svg>
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
