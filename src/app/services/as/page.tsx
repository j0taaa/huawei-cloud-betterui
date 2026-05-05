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
  Gauge,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  TrendingUp,
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
  title: "Auto Scaling | Huawei Cloud Better UI",
  description: "Auto Scaling group management page.",
};

const stats = [
  ["Scaling groups", "8", "6 enabled", Activity, "text-[#2563eb]"],
  ["Active instances", "64", "12 added today", Server, "text-[#16a34a]"],
  ["Policies", "21", "CPU and schedule based", Settings2, "text-[#9333ea]"],
  ["Scaling actions", "34", "Last 7 days", TrendingUp, "text-[#f97316]"],
] as const;

const groups = [
  {
    id: "as-commerce-api",
    name: "as-commerce-api",
    status: "Enabled",
    min: "4",
    desired: "8",
    max: "16",
    instances: "8",
    policy: "CPU > 70%",
    cooldown: "300s",
    zone: "sa-brazil-1a/b",
  },
  {
    id: "as-worker-batch",
    name: "as-worker-batch",
    status: "Enabled",
    min: "2",
    desired: "6",
    max: "20",
    instances: "6",
    policy: "Queue depth",
    cooldown: "180s",
    zone: "sa-brazil-1b",
  },
  {
    id: "as-staging-web",
    name: "as-staging-web",
    status: "Paused",
    min: "1",
    desired: "2",
    max: "4",
    instances: "2",
    policy: "Schedule",
    cooldown: "600s",
    zone: "sa-brazil-1a",
  },
];

const actions = [
  ["Create group", Plus, "bg-[#2563eb] text-white"],
  ["Add policy", Settings2, "border border-[#d9e0eb] bg-white"],
  ["Refresh", RefreshCw, "border border-[#d9e0eb] bg-white"],
] as const;

const statusClasses = {
  Enabled: "bg-[#e9f8f1] text-[#15803d]",
  Paused: "bg-[#fff7ed] text-[#c2410c]",
};

const postureRows = [
  ["Average CPU target", "68%", Gauge],
  ["Fastest scale-out", "42 seconds", Zap],
  ["Protected instances", "6", Server],
  ["Cooldown compliance", "Healthy", CheckCircle2],
] as const;

export default function AutoScalingPage() {
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
                    <Activity className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Auto Scaling
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage scaling groups, launch configurations, policies,
                      cooldowns, and scaling history.
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
                    <h2 className="text-lg font-black">Scaling groups</h2>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Capacity automation for ECS fleets.
                    </p>
                  </div>
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                    <Search className="size-4" />
                    <input
                      aria-label="Search Auto Scaling groups"
                      className="w-48 bg-transparent outline-none"
                      placeholder="Search groups"
                    />
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Group</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Min</th>
                        <th className="px-5 py-3">Desired</th>
                        <th className="px-5 py-3">Max</th>
                        <th className="px-5 py-3">Instances</th>
                        <th className="px-5 py-3">Policy</th>
                        <th className="px-5 py-3">Cooldown</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e9f2]">
                      {groups.map((group) => (
                        <tr
                          className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                          key={group.id}
                        >
                          <td className="px-5 py-4">
                            <Link
                              aria-label={`Open ${group.name}`}
                              className="absolute inset-0 z-10"
                              href={`/services/as/${group.id}`}
                            />
                            <div className="font-black">{group.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#667085]">
                              {group.zone}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                statusClasses[
                                  group.status as keyof typeof statusClasses
                                ]
                              }`}
                            >
                              {group.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-bold">{group.min}</td>
                          <td className="px-5 py-4 font-bold">
                            {group.desired}
                          </td>
                          <td className="px-5 py-4 font-bold">{group.max}</td>
                          <td className="px-5 py-4 font-bold">
                            {group.instances}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {group.policy}
                          </td>
                          <td className="px-5 py-4 text-[#667085]">
                            {group.cooldown}
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
                  <h2 className="text-lg font-black">Scaling posture</h2>
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
