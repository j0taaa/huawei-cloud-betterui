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
  GitBranch,
  Layers3,
  MapPin,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import { ServiceCommandSearch } from "@/components/service-command-search";

export const metadata: Metadata = {
  title: "CCE | Huawei Cloud Better UI",
  description: "Cloud Container Engine management page.",
};

const stats = [
  ["Clusters", "3", "All healthy", Layers3, "text-[#2563eb]"],
  ["Worker nodes", "42", "38 ready", Server, "text-[#16a34a]"],
  ["vCPU requested", "312", "64% allocated", Cpu, "text-[#9333ea]"],
  ["Namespaces", "18", "6 production", GitBranch, "text-[#f97316]"],
] as const;

const clusters = [
  {
    id: "cce-prod-core",
    name: "cce-prod-core",
    status: "Running",
    version: "v1.29.4-r0",
    flavor: "Turbo",
    nodes: "24",
    vpc: "vpc-commerce-core",
    workloads: "186",
    cpu: "68%",
    region: "AL-São Paulo1",
  },
  {
    id: "cce-prod-ml",
    name: "cce-prod-ml",
    status: "Running",
    version: "v1.28.8-r0",
    flavor: "Standard",
    nodes: "12",
    vpc: "vpc-analytics",
    workloads: "74",
    cpu: "51%",
    region: "AL-São Paulo1",
  },
  {
    id: "cce-staging-apps",
    name: "cce-staging-apps",
    status: "Upgrading",
    version: "v1.29.2-r0",
    flavor: "Standard",
    nodes: "6",
    vpc: "vpc-staging",
    workloads: "39",
    cpu: "24%",
    region: "AL-São Paulo1",
  },
];

const actions = [
  ["Create cluster", Plus, "bg-[#2563eb] text-white"],
  ["Scale nodes", Server, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const statusClasses = {
  Running: "bg-[#e9f8f1] text-[#15803d]",
  Upgrading: "bg-[#fff7ed] text-[#c2410c]",
};

const postureRows = [
  ["Cluster network", "VPC-native", Network],
  ["RBAC", "Enabled", ShieldCheck],
  ["Add-ons", "8 installed", Layers3],
  ["Control plane", "Managed", CheckCircle2],
] as const;

export default function CcePage() {
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
                  <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                    <Layers3 className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Cloud Container Engine
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage Kubernetes clusters, nodes, workloads, networking,
                      and add-ons.
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
                    <h2 className="text-lg font-black">Clusters</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Kubernetes cluster inventory for the selected project.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                      <Search className="size-4" />
                      <input
                        aria-label="Search CCE clusters"
                        className="w-48 bg-transparent outline-none"
                        placeholder="Search clusters"
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
                        <th className="px-5 py-3">Cluster</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Version</th>
                        <th className="px-5 py-3">Flavor</th>
                        <th className="px-5 py-3">Nodes</th>
                        <th className="px-5 py-3">VPC</th>
                        <th className="px-5 py-3">Workloads</th>
                        <th className="px-5 py-3">CPU</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {clusters.map((cluster) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={cluster.id}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${cluster.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/cce/${cluster.id}`}
                            />
                            <div className="font-black">{cluster.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              {cluster.region}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                statusClasses[
                                  cluster.status as keyof typeof statusClasses
                                ]
                              }`}
                            >
                              {cluster.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {cluster.version}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {cluster.flavor}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {cluster.nodes}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {cluster.vpc}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {cluster.workloads}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {cluster.cpu}
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
                  <h2 className="text-lg font-black">Cluster posture</h2>
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
                  <h2 className="text-lg font-black">Node readiness</h2>
                  <div className="mt-5 rounded-lg bg-[#fbfcfe] p-4">
                    <div className="mb-3 flex items-end justify-between">
                      <span className="text-sm font-bold text-[#667085]">
                        Ready nodes
                      </span>
                      <span className="text-2xl font-black">38 / 42</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#e4e9f2]">
                      <div className="h-full w-[90%] bg-[#16a34a]" />
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
