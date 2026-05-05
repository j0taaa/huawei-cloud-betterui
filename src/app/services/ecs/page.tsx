import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Cpu,
  Database,
  Globe2,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  Square,
  TerminalSquare,
  UserRound,
} from "lucide-react";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import { ServiceCommandSearch } from "@/components/service-command-search";

export const metadata: Metadata = {
  title: "ECS | Huawei Cloud Better UI",
  description: "Elastic Cloud Server management page.",
};

const stats = [
  ["Instances", "24", "8 running in SA-Brazil", Server, "text-[#2563eb]"],
  ["vCPU allocated", "128", "46% average use", Cpu, "text-[#16a34a]"],
  ["Memory", "512 GB", "312 GB reserved", Database, "text-[#9333ea]"],
  ["Public EIPs", "9", "2 unattached", Globe2, "text-[#f97316]"],
] as const;

const instances = [
  {
    name: "ecs-prod-api-01",
    id: "i-7f42a9b1",
    status: "Running",
    flavor: "c7.large.4",
    image: "Huawei Cloud EulerOS 2.0",
    privateIp: "10.24.8.41",
    publicIp: "177.92.14.18",
    cpu: "31%",
    memory: "58%",
    billing: "Yearly/Monthly",
  },
  {
    name: "ecs-prod-web-02",
    id: "i-9c13fd72",
    status: "Running",
    flavor: "s6.medium.2",
    image: "Ubuntu 22.04",
    privateIp: "10.24.8.62",
    publicIp: "177.92.14.27",
    cpu: "18%",
    memory: "42%",
    billing: "Pay-per-use",
  },
  {
    name: "ecs-worker-12",
    id: "i-21ab77e0",
    status: "Warning",
    flavor: "c7.xlarge.4",
    image: "CentOS 7.9",
    privateIp: "10.24.12.18",
    publicIp: "-",
    cpu: "89%",
    memory: "76%",
    billing: "Pay-per-use",
  },
  {
    name: "ecs-staging-jobs-01",
    id: "i-63e92bb4",
    status: "Stopped",
    flavor: "s6.large.2",
    image: "Debian 12",
    privateIp: "10.24.21.10",
    publicIp: "-",
    cpu: "0%",
    memory: "0%",
    billing: "Pay-per-use",
  },
];

const actions = [
  ["Create ECS", Plus, "bg-[#2563eb] text-white"],
  ["Remote login", TerminalSquare, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const statusClasses = {
  Running: "bg-[#e9f8f1] text-[#15803d]",
  Warning: "bg-[#fff7ed] text-[#c2410c]",
  Stopped: "bg-[#f2f4f7] text-[#667085]",
};

export default function EcsPage() {
  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active="Compute" />
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
                  <Server className="size-6" />
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight">
                    Elastic Cloud Server
                  </h1>
                  <p className="mt-1 text-sm font-medium text-[#667085]">
                    Create, monitor, connect, resize, and protect ECS instances.
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
                  <h2 className="text-lg font-black">Instances</h2>
                  <p className="mt-1 text-sm font-medium text-[#667085]">
                    Inventory for AL-São Paulo1. Data is mocked until API
                    integration is added.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                    <Search className="size-4" />
                    <input
                      aria-label="Search ECS instances"
                      className="w-48 bg-transparent outline-none"
                      placeholder="Search instances"
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
                      <th className="px-5 py-3">Instance</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Flavor</th>
                      <th className="px-5 py-3">Private IP</th>
                      <th className="px-5 py-3">Public IP</th>
                      <th className="px-5 py-3">CPU</th>
                      <th className="px-5 py-3">Memory</th>
                      <th className="px-5 py-3">Billing</th>
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
                            href={`/services/ecs/${instance.id}`}
                          />
                          <div className="font-black">{instance.name}</div>
                          <div className="mt-1 text-xs font-semibold text-[#667085]">
                            {instance.id} · {instance.image}
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
                          {instance.flavor}
                        </td>
                        <td className="px-5 py-4 font-semibold">
                          {instance.privateIp}
                        </td>
                        <td className="px-5 py-4 font-semibold">
                          {instance.publicIp}
                        </td>
                        <td className="px-5 py-4 font-bold">{instance.cpu}</td>
                        <td className="px-5 py-4 font-bold">
                          {instance.memory}
                        </td>
                        <td className="px-5 py-4 text-[#667085]">
                          {instance.billing}
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
                <h2 className="text-lg font-black">Usage trend</h2>
                <div className="mt-5 rounded-lg bg-[#fbfcfe] p-4">
                  <div className="mb-4 flex gap-4 text-xs font-bold text-[#667085]">
                    <span className="flex items-center gap-2">
                      <Square className="size-3 fill-[#2563eb] text-[#2563eb]" />
                      CPU
                    </span>
                    <span className="flex items-center gap-2">
                      <Square className="size-3 fill-[#16a34a] text-[#16a34a]" />
                      Memory
                    </span>
                  </div>
                  <svg className="h-40 w-full" viewBox="0 0 280 140">
                    <polyline
                      fill="none"
                      points="0,92 28,78 56,88 84,70 112,80 140,62 168,74 196,58 224,70 252,46 280,60"
                      stroke="#2563eb"
                      strokeWidth="4"
                    />
                    <polyline
                      fill="none"
                      points="0,76 28,66 56,72 84,58 112,64 140,50 168,58 196,44 224,52 252,36 280,42"
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
