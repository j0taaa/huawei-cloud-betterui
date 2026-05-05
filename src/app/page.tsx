import {
  ArrowRight,
  Bell,
  Box,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Database,
  Globe2,
  HardDrive,
  Layers3,
  MapPin,
  Network,
  Plus,
  Server,
  Settings,
  ShieldCheck,
  TriangleAlert,
  UploadCloud,
  UserRound,
  WalletCards,
} from "lucide-react";
import { redirect } from "next/navigation";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import { LogoutButton } from "@/components/logout-button";
import { ServiceCommandSearch } from "@/components/service-command-search";
import { getCurrentSession } from "@/lib/auth-session";

const resourceCards = [
  {
    title: "Running Instances",
    value: "24",
    detail: "8 running in SA-Brazil",
    icon: Server,
    tone: "blue",
  },
  {
    title: "Storage Usage",
    value: "4.2 TB",
    detail: "68% of quota",
    icon: HardDrive,
    tone: "green",
  },
  {
    title: "Security Groups",
    value: "41",
    detail: "3 need review",
    icon: ShieldCheck,
    tone: "red",
  },
  {
    title: "Monthly Cost",
    value: "$3,870",
    detail: "6% below forecast",
    icon: WalletCards,
    tone: "orange",
  },
] as const;

const infrastructure = [
  ["Virtual Machines", "24", "8 running", Server, "text-[#2563eb]"],
  ["Object Storage", "4.2 TB", "68% used", HardDrive, "text-[#16a34a]"],
  ["VPC Networks", "17", "3 regions", Network, "text-[#0891b2]"],
  ["Databases", "12", "2 High CPU", Database, "text-[#9333ea]"],
  ["Buckets", "20", "All healthy", Box, "text-[#0f766e]"],
  ["Load Balancers", "7", "All healthy", Layers3, "text-[#4f46e5]"],
] as const;

const activity = [
  ["Virtual machine ecs-web-01 started", "2 minutes ago", CheckCircle2, "text-[#16a34a]"],
  ["OBS object data-export-2026.csv uploaded", "15 minutes ago", UploadCloud, "text-[#2563eb]"],
  ["RDS backup completed", "1 hour ago", Database, "text-[#9333ea]"],
  ["High CPU usage on ecs-worker-12", "2 hours ago", TriangleAlert, "text-[#f97316]"],
] as const;

const quickActions = [
  ["Create VM", "Launch a new server", Plus, "text-[#2563eb]"],
  ["Upload Object", "Send files to OBS", UploadCloud, "text-[#16a34a]"],
  ["Create Database", "Provision RDS", Database, "text-[#9333ea]"],
  ["Review Security", "Check risks", ShieldCheck, "text-[#dc2626]"],
] as const;

const healthRows = ["Compute", "Storage", "Networking", "Databases", "Security"];

const toneClasses = {
  blue: "bg-[#eaf2ff] text-[#2563eb]",
  green: "bg-[#e9f8f1] text-[#16a34a]",
  red: "bg-[#fff1f2] text-[#dc2626]",
  orange: "bg-[#fff4e8] text-[#f97316]",
};

export default async function Home() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const accountName = session.accountName;
  const projectName = session.projectName;
  const region = session.region;
  const username = session.username;

  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active="Dashboard" />
        <CloudSidebarInset>
        <header className="sticky top-0 z-20 border-b border-[#e4e9f2] bg-white/90 backdrop-blur-xl">
          <div className="flex min-h-20 flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex flex-wrap items-center gap-3">
                <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <Cloud className="size-4 text-[#2563eb]" />
                {projectName}
                <ChevronDown className="size-4 text-[#667085]" />
              </button>
              <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                <MapPin className="size-4 text-[#d7000f]" />
                {region}
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
              <Globe2 className="size-5 text-[#475467]" />
              <div className="hidden items-center gap-3 border-l border-[#e4e9f2] pl-4 sm:flex">
                <div className="grid size-10 place-items-center rounded-full bg-[#f0f3f8]">
                  <UserRound className="size-5 text-[#667085]" />
                </div>
                <div>
                  <p className="text-sm font-extrabold">{username}</p>
                  <p className="text-xs font-semibold text-[#667085]">
                    {accountName}
                  </p>
                </div>
              </div>
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="grid gap-6 p-4 lg:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight">
                Cloud Dashboard
              </h1>
            </div>
            <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm hover:bg-[#f8fafc]">
              <Settings className="size-4" />
              Customize
            </button>
          </div>

          <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {resourceCards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
                  key={card.title}
                >
                  <div className="flex items-center justify-between">
                    <div className={`grid size-12 place-items-center rounded-full ${toneClasses[card.tone]}`}>
                      <Icon className="size-6" />
                    </div>
                    <span className="text-xs font-bold text-[#16a34a]">
                      ↑ healthy
                    </span>
                  </div>
                  <p className="mt-5 text-sm font-bold text-[#344054]">
                    {card.title}
                  </p>
                  <p className="mt-1 text-3xl font-black tracking-tight">
                    {card.value}
                  </p>
                  <p className="mt-3 text-sm font-medium text-[#667085]">
                    {card.detail}
                  </p>
                </article>
              );
            })}
          </section>

          <section className="grid gap-6 2xl:grid-cols-[1.15fr_1fr_0.8fr]">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-black">Infrastructure Overview</h2>
                <a className="flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                  View all resources
                  <ArrowRight className="size-4" />
                </a>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {infrastructure.map(([label, value, detail, Icon, color]) => (
                  <div
                    className="rounded-lg border border-[#e4e9f2] bg-[#fbfcfe] p-4"
                    key={label}
                  >
                    <div className="flex items-start gap-4">
                      <div className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
                        <Icon className={`size-6 ${color}`} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#475467]">
                          {label}
                        </p>
                        <p className="mt-1 text-2xl font-black">{value}</p>
                        <p className="mt-2 text-sm font-bold text-[#16a34a]">
                          {detail}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-black">Resource Usage</h2>
                <button className="rounded-lg border border-[#d9e0eb] px-3 py-2 text-xs font-bold">
                  Last 7 days
                </button>
              </div>
              <div className="mb-4 flex gap-5 text-xs font-bold text-[#667085]">
                <span className="flex items-center gap-2">
                  <i className="size-2 rounded-full bg-[#2563eb]" />
                  CPU
                </span>
                <span className="flex items-center gap-2">
                  <i className="size-2 rounded-full bg-[#16a34a]" />
                  Memory
                </span>
                <span className="flex items-center gap-2">
                  <i className="size-2 rounded-full bg-[#9333ea]" />
                  Disk
                </span>
              </div>
              <div className="relative h-64 overflow-hidden rounded-lg bg-[#fbfcfe] p-4">
                <div className="absolute inset-x-4 top-1/4 border-t border-[#e4e9f2]" />
                <div className="absolute inset-x-4 top-1/2 border-t border-[#e4e9f2]" />
                <div className="absolute inset-x-4 top-3/4 border-t border-[#e4e9f2]" />
                <svg className="relative h-full w-full" viewBox="0 0 420 210">
                  <polyline
                    fill="none"
                    points="0,120 35,104 70,118 105,96 140,110 175,90 210,82 245,98 280,76 315,88 350,70 385,82 420,64"
                    stroke="#16a34a"
                    strokeWidth="4"
                  />
                  <polyline
                    fill="none"
                    points="0,150 35,138 70,146 105,132 140,142 175,130 210,136 245,120 280,128 315,114 350,126 385,118 420,108"
                    stroke="#2563eb"
                    strokeWidth="4"
                  />
                  <polyline
                    fill="none"
                    points="0,178 35,170 70,174 105,166 140,172 175,164 210,170 245,158 280,164 315,152 350,160 385,156 420,148"
                    stroke="#9333ea"
                    strokeWidth="4"
                  />
                </svg>
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-black">Recent Activity</h2>
                <a className="text-sm font-bold text-[#2563eb]">View all</a>
              </div>
              <div className="grid gap-5">
                {activity.map(([label, time, Icon, color]) => (
                  <div className="flex gap-3" key={label}>
                    <Icon className={`mt-0.5 size-5 ${color}`} />
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
          </section>

          <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-black">Service Health</h2>
                <a className="flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                  View all
                  <ArrowRight className="size-4" />
                </a>
              </div>
              <div className="divide-y divide-[#e4e9f2]">
                {healthRows.map((service) => (
                  <div
                    className="flex items-center justify-between py-3"
                    key={service}
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#475467]">
                      <CheckCircle2 className="size-5 text-[#16a34a]" />
                      {service}
                    </span>
                    <span className="text-sm font-bold text-[#16a34a]">
                      Operational
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="mb-4 text-lg font-black">Quick Actions</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {quickActions.map(([title, detail, Icon, color]) => (
                  <button
                    className="flex items-center gap-4 rounded-lg border border-[#e4e9f2] bg-[#fbfcfe] p-4 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_10px_28px_rgba(16,24,40,0.08)]"
                    key={title}
                  >
                    <Icon className={`size-7 ${color}`} />
                    <span>
                      <span className="block text-sm font-black">{title}</span>
                      <span className="mt-1 block text-xs font-semibold text-[#667085]">
                        {detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </article>
          </section>
        </main>
        </CloudSidebarInset>
      </div>
    </CloudSidebarProvider>
  );
}
