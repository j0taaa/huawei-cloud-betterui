import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudCog,
  Gauge,
  Globe2,
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
  title: "ELB | Huawei Cloud Better UI",
  description: "Elastic Load Balance management page.",
};

const stats = [
  ["Load balancers", "7", "6 healthy", CloudCog, "text-[#2563eb]"],
  ["Listeners", "18", "HTTP, HTTPS, TCP", Network, "text-[#16a34a]"],
  ["Backend servers", "42", "39 healthy", Server, "text-[#9333ea]"],
  ["Traffic today", "1.2 TB", "18% vs yesterday", Activity, "text-[#f97316]"],
] as const;

const loadBalancers = [
  {
    id: "elb-commerce-public",
    name: "commerce-public",
    type: "Dedicated",
    status: "Healthy",
    vip: "177.92.14.80",
    vpc: "vpc-commerce-core",
    listeners: "6",
    backends: "18",
    algorithm: "Weighted round robin",
  },
  {
    id: "elb-api-internal",
    name: "api-internal",
    type: "Shared",
    status: "Healthy",
    vip: "10.24.8.10",
    vpc: "vpc-commerce-core",
    listeners: "3",
    backends: "12",
    algorithm: "Least connections",
  },
  {
    id: "elb-staging-public",
    name: "staging-public",
    type: "Shared",
    status: "Warning",
    vip: "177.92.14.91",
    vpc: "vpc-staging",
    listeners: "2",
    backends: "4",
    algorithm: "Round robin",
  },
];

const actions = [
  ["Create ELB", Plus, "bg-[#2563eb] text-white"],
  ["Add listener", Network, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const statusClasses = {
  Healthy: "bg-[#e9f8f1] text-[#15803d]",
  Warning: "bg-[#fff7ed] text-[#c2410c]",
};

const postureRows = [
  ["Public endpoints", "3 exposed", Globe2],
  ["TLS certificates", "5 active", ShieldCheck],
  ["Health checks", "16 passing", CheckCircle2],
  ["Capacity mode", "Auto scaling", Gauge],
] as const;

export default function ElbPage() {
  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active="Networking" />
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
                    <CloudCog className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Elastic Load Balance
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage public and private load balancers, listeners,
                      backend pools, and health checks.
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
                    <h2 className="text-lg font-black">Load balancers</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Traffic distribution resources for VPC workloads.
                    </p>
                  </div>
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                    <Search className="size-4" />
                    <input
                      aria-label="Search load balancers"
                      className="w-48 bg-transparent outline-none"
                      placeholder="Search ELBs"
                    />
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Load balancer</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Type</th>
                        <th className="px-5 py-3">VIP</th>
                        <th className="px-5 py-3">VPC</th>
                        <th className="px-5 py-3">Listeners</th>
                        <th className="px-5 py-3">Backends</th>
                        <th className="px-5 py-3">Algorithm</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {loadBalancers.map((loadBalancer) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={loadBalancer.id}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${loadBalancer.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/elb/${loadBalancer.id}`}
                            />
                            <div className="font-black">{loadBalancer.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              {loadBalancer.id}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                statusClasses[
                                  loadBalancer.status as keyof typeof statusClasses
                                ]
                              }`}
                            >
                              {loadBalancer.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {loadBalancer.type}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {loadBalancer.vip}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {loadBalancer.vpc}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {loadBalancer.listeners}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {loadBalancer.backends}
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {loadBalancer.algorithm}
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
                  <h2 className="text-lg font-black">ELB posture</h2>
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
