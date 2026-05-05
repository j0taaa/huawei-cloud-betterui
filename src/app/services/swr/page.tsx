import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Code2,
  DatabaseBackup,
  Download,
  GitBranch,
  KeyRound,
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
  title: "SWR | Huawei Cloud Better UI",
  description: "Software Repository for Container management page.",
};

const stats = [
  ["Repositories", "34", "12 production", Code2, "text-[#2563eb]"],
  ["Image tags", "1,284", "86 pushed this week", GitBranch, "text-[#16a34a]"],
  ["Pulls today", "42.8K", "18% from CCE", Download, "text-[#9333ea]"],
  ["Scan findings", "7", "2 high severity", ShieldCheck, "text-[#f97316]"],
] as const;

const repositories = [
  {
    id: "acme-api",
    name: "acme/api",
    namespace: "acme-prod",
    visibility: "Private",
    tags: "142",
    latest: "v2.18.4",
    size: "18.4 GB",
    pulls: "18.2K",
    scan: "Passed",
    updated: "9 minutes ago",
  },
  {
    id: "acme-worker",
    name: "acme/worker",
    namespace: "acme-prod",
    visibility: "Private",
    tags: "88",
    latest: "v1.42.1",
    size: "9.1 GB",
    pulls: "8.4K",
    scan: "Warning",
    updated: "31 minutes ago",
  },
  {
    id: "platform-nginx",
    name: "platform/nginx",
    namespace: "platform",
    visibility: "Public read",
    tags: "24",
    latest: "1.27.1-hardened",
    size: "1.2 GB",
    pulls: "11.9K",
    scan: "Passed",
    updated: "2 hours ago",
  },
  {
    id: "jobs-exporter",
    name: "jobs/exporter",
    namespace: "acme-prod",
    visibility: "Private",
    tags: "63",
    latest: "v0.19.0",
    size: "3.8 GB",
    pulls: "4.3K",
    scan: "Passed",
    updated: "5 hours ago",
  },
];

const actions = [
  ["Create repository", Plus, "bg-[#2563eb] text-white"],
  ["Push image", UploadCloud, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const scanClasses = {
  Passed: "bg-[#e9f8f1] text-[#15803d]",
  Warning: "bg-[#fff7ed] text-[#c2410c]",
};

const postureRows = [
  ["Immutable tags", "Enabled on 9 repos", LockKeyhole],
  ["Vulnerability scanning", "Automatic", ShieldCheck],
  ["Retention policies", "18 active", DatabaseBackup],
  ["Access tokens", "6 active", KeyRound],
] as const;

export default function SwrPage() {
  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active="Containers" />
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
                    <Code2 className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Software Repository for Container
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage container image repositories, tags, scans, and
                      registry access.
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
                    <h2 className="text-lg font-black">Repositories</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Container image repositories for your namespaces.
                    </p>
                  </div>
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                    <Search className="size-4" />
                    <input
                      aria-label="Search SWR repositories"
                      className="w-48 bg-transparent outline-none"
                      placeholder="Search repositories"
                    />
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Repository</th>
                        <th className="px-5 py-3">Visibility</th>
                        <th className="px-5 py-3">Tags</th>
                        <th className="px-5 py-3">Latest</th>
                        <th className="px-5 py-3">Size</th>
                        <th className="px-5 py-3">Pulls</th>
                        <th className="px-5 py-3">Scan</th>
                        <th className="px-5 py-3">Updated</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {repositories.map((repository) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={repository.id}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${repository.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/swr/${repository.id}`}
                            />
                            <div className="font-black">{repository.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              {repository.namespace}
                            </div>
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {repository.visibility}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {repository.tags}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {repository.latest}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {repository.size}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {repository.pulls}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                scanClasses[
                                  repository.scan as keyof typeof scanClasses
                                ]
                              }`}
                            >
                              {repository.scan}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {repository.updated}
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
                  <h2 className="text-lg font-black">Registry posture</h2>
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
                  <h2 className="text-lg font-black">Pull activity</h2>
                  <div className="mt-5 rounded-lg bg-[#fbfcfe] p-4">
                    <div className="mb-3 flex items-end justify-between">
                      <span className="text-sm font-bold text-[#667085]">
                        Pulls today
                      </span>
                      <span className="text-2xl font-black">42.8K</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#e4e9f2]">
                      <div className="h-full w-[74%] bg-[#2563eb]" />
                    </div>
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
