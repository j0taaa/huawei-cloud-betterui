import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Box,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  DatabaseBackup,
  FileArchive,
  Globe2,
  HardDrive,
  LockKeyhole,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
  UserRound,
} from "lucide-react";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import { ServiceCommandSearch } from "@/components/service-command-search";

export const metadata: Metadata = {
  title: "OBS | Huawei Cloud Better UI",
  description: "Object Storage Service management page.",
};

const stats = [
  ["Buckets", "20", "18 private, 2 public", Box, "text-[#2563eb]"],
  ["Stored data", "4.2 TB", "68% of quota", HardDrive, "text-[#16a34a]"],
  ["Monthly requests", "12.8M", "9% more than last month", Globe2, "text-[#9333ea]"],
  ["Lifecycle rules", "14", "6 archive enabled", FileArchive, "text-[#f97316]"],
] as const;

const buckets = [
  {
    name: "obs-customer-exports",
    region: "AL-São Paulo1",
    storageClass: "Standard",
    access: "Private",
    objects: "1.8M",
    size: "1.6 TB",
    versioning: "Enabled",
    updated: "5 minutes ago",
  },
  {
    name: "obs-static-assets",
    region: "AL-São Paulo1",
    storageClass: "Standard",
    access: "Public read",
    objects: "284K",
    size: "420 GB",
    versioning: "Enabled",
    updated: "22 minutes ago",
  },
  {
    name: "obs-backups-prod",
    region: "LA-Santiago",
    storageClass: "Warm",
    access: "Private",
    objects: "96K",
    size: "1.9 TB",
    versioning: "Enabled",
    updated: "1 hour ago",
  },
  {
    name: "obs-audit-logs",
    region: "AL-São Paulo1",
    storageClass: "Cold",
    access: "Private",
    objects: "8.4M",
    size: "310 GB",
    versioning: "Suspended",
    updated: "3 hours ago",
  },
];

const actions = [
  ["Create bucket", Plus, "bg-[#2563eb] text-white"],
  ["Upload object", UploadCloud, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const accessClasses = {
  Private: "bg-[#e9f8f1] text-[#15803d]",
  "Public read": "bg-[#fff7ed] text-[#c2410c]",
};

const policyRows = [
  ["Default encryption", "Enabled", LockKeyhole],
  ["Public access guard", "1 bucket needs review", ShieldCheck],
  ["Cross-region replication", "3 buckets", DatabaseBackup],
  ["Lifecycle to archive", "6 rules active", FileArchive],
] as const;

export default function ObsPage() {
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
                  <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                    <Box className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Object Storage Service
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage buckets, objects, access policies, lifecycle, and
                      replication.
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
                    <h2 className="text-lg font-black">Buckets</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Bucket inventory for the selected project and region.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                      <Search className="size-4" />
                      <input
                        aria-label="Search OBS buckets"
                        className="w-48 bg-transparent outline-none"
                        placeholder="Search buckets"
                      />
                    </label>
                    <button className="h-10 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold">
                      Access: All
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Bucket</th>
                        <th className="px-5 py-3">Access</th>
                        <th className="px-5 py-3">Region</th>
                        <th className="px-5 py-3">Storage class</th>
                        <th className="px-5 py-3">Objects</th>
                        <th className="px-5 py-3">Size</th>
                        <th className="px-5 py-3">Versioning</th>
                        <th className="px-5 py-3">Updated</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {buckets.map((bucket) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={bucket.name}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${bucket.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/obs/${bucket.name}`}
                            />
                            <div className="font-black">{bucket.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              obs://{bucket.name}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                accessClasses[
                                  bucket.access as keyof typeof accessClasses
                                ]
                              }`}
                            >
                              {bucket.access}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {bucket.region}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {bucket.storageClass}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {bucket.objects}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {bucket.size}
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {bucket.versioning}
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {bucket.updated}
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
                    {policyRows.map(([label, value, Icon]) => (
                      <div
                        className="flex items-center justify-between gap-4 py-3"
                        key={label}
                      >
                        <span className="flex items-center gap-3 text-sm font-bold text-[#475467]">
                          <Icon className="size-5 text-[#2563eb]" />
                          {label}
                        </span>
                        <span className="text-right text-sm font-black text-[#101828]">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
                  <h2 className="text-lg font-black">Storage trend</h2>
                  <div className="mt-5 rounded-lg bg-[#fbfcfe] p-4">
                    <div className="mb-4 flex gap-4 text-xs font-bold text-[#667085]">
                      <span className="flex items-center gap-2">
                        <i className="size-3 rounded-sm bg-[#16a34a]" />
                        Used
                      </span>
                      <span className="flex items-center gap-2">
                        <i className="size-3 rounded-sm bg-[#2563eb]" />
                        Requests
                      </span>
                    </div>
                    <svg className="h-40 w-full" viewBox="0 0 280 140">
                      <polyline
                        fill="none"
                        points="0,96 28,92 56,86 84,80 112,72 140,70 168,62 196,58 224,52 252,44 280,38"
                        stroke="#16a34a"
                        strokeWidth="4"
                      />
                      <polyline
                        fill="none"
                        points="0,104 28,82 56,94 84,66 112,84 140,58 168,72 196,52 224,68 252,40 280,56"
                        stroke="#2563eb"
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
