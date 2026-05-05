import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudCog,
  Globe2,
  LockKeyhole,
  MapPin,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Route,
  Search,
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
  title: "Networking | Huawei Cloud Better UI",
  description: "VPC, subnet, security group, EIP, and load balancer management.",
};

const stats = [
  ["VPCs", "17", "3 regions", Network, "text-[#2563eb]"],
  ["Subnets", "42", "8 production", Route, "text-[#16a34a]"],
  ["Security groups", "41", "3 need review", ShieldCheck, "text-[#9333ea]"],
  ["Elastic IPs", "9", "2 unattached", Globe2, "text-[#f97316]"],
] as const;

const vpcs = [
  {
    id: "vpc-commerce-core",
    name: "vpc-commerce-core",
    cidr: "10.24.0.0/16",
    subnets: "8",
    routeTables: "3",
    securityGroups: "12",
    region: "AL-São Paulo1",
    status: "Healthy",
  },
  {
    id: "vpc-analytics",
    name: "vpc-analytics",
    cidr: "10.40.0.0/16",
    subnets: "6",
    routeTables: "2",
    securityGroups: "9",
    region: "AL-São Paulo1",
    status: "Healthy",
  },
  {
    id: "vpc-staging",
    name: "vpc-staging",
    cidr: "10.52.0.0/16",
    subnets: "4",
    routeTables: "1",
    securityGroups: "5",
    region: "AL-São Paulo1",
    status: "Review",
  },
];

const subnets = [
  ["subnet-prod-api", "vpc-commerce-core", "10.24.8.0/24", "186 used", "Available"],
  ["subnet-prod-db", "vpc-commerce-core", "10.24.12.0/24", "42 used", "Available"],
  ["subnet-cce-nodes", "vpc-commerce-core", "10.24.32.0/20", "312 used", "Available"],
] as const;

const securityGroups = [
  ["sg-prod-web", "vpc-commerce-core", "18 rules", "ECS, ELB", "Healthy"],
  ["sg-prod-db", "vpc-commerce-core", "9 rules", "RDS, ECS", "Healthy"],
  ["sg-staging-open", "vpc-staging", "22 rules", "ECS", "Review"],
] as const;

const edgeResources = [
  ["EIP 177.92.14.18", "Bound", "ecs-prod-api-01", Globe2],
  ["ELB commerce-public", "Healthy", "6 listeners", CloudCog],
  ["NAT gateway nat-prod", "Healthy", "3 SNAT rules", Route],
  ["VPN vpn-office", "Healthy", "2 tunnels", LockKeyhole],
] as const;

const statusClasses = {
  Healthy: "bg-[#e9f8f1] text-[#15803d]",
  Review: "bg-[#fff7ed] text-[#c2410c]",
  Available: "bg-[#e9f8f1] text-[#15803d]",
};

export default function NetworkPage() {
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
                    <Network className="size-6" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">
                      Networking
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[#667085]">
                      Manage VPCs, subnets, routes, security groups, EIPs, NAT,
                      VPN, and load balancers.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {[
                  ["Create VPC", Plus],
                  ["Refresh", RefreshCw],
                ].map(([label, Icon]) => (
                  <button
                    className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm first:border-0 first:bg-[#2563eb] first:text-white"
                    key={label as string}
                  >
                    <Icon className="size-4" />
                    {label as string}
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

            <section className="grid gap-6 2xl:grid-cols-[1fr_390px]">
              <div className="grid gap-6">
                <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
                  <div className="flex flex-col gap-4 border-b border-[#e4e9f2] p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="text-lg font-black">VPCs</h2>
                      <p className="mt-1 text-sm font-medium text-[#667085]">
                        Private cloud networks and their attached resources.
                      </p>
                    </div>
                    <label className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                      <Search className="size-4" />
                      <input
                        aria-label="Search VPCs"
                        className="w-48 bg-transparent outline-none"
                        placeholder="Search VPCs"
                      />
                    </label>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-sm">
                      <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                        <tr>
                          <th className="px-5 py-3">VPC</th>
                          <th className="px-5 py-3">CIDR</th>
                          <th className="px-5 py-3">Subnets</th>
                          <th className="px-5 py-3">Routes</th>
                          <th className="px-5 py-3">Security groups</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e4e9f2]">
                        {vpcs.map((vpc) => (
                          <tr
                            className="group relative cursor-pointer hover:bg-[#fbfcfe]"
                            key={vpc.id}
                          >
                            <td className="px-5 py-4">
                              <Link
                                aria-label={`Open ${vpc.name}`}
                                className="absolute inset-0 z-10"
                                href={`/services/network/vpcs/${vpc.id}`}
                              />
                              <div className="font-black">{vpc.name}</div>
                              <div className="mt-1 text-xs font-semibold text-[#667085]">
                                {vpc.region}
                              </div>
                            </td>
                            <td className="px-5 py-4 font-semibold">
                              {vpc.cidr}
                            </td>
                            <td className="px-5 py-4 font-bold">
                              {vpc.subnets}
                            </td>
                            <td className="px-5 py-4 font-bold">
                              {vpc.routeTables}
                            </td>
                            <td className="px-5 py-4 font-bold">
                              {vpc.securityGroups}
                            </td>
                            <td className="px-5 py-4">
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                  statusClasses[
                                    vpc.status as keyof typeof statusClasses
                                  ]
                                }`}
                              >
                                {vpc.status}
                              </span>
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

                <div className="grid gap-6 xl:grid-cols-2">
                  <ResourceList
                    detailBase="/services/network/subnets"
                    rows={subnets}
                    title="Subnets"
                  />
                  <ResourceList
                    detailBase="/services/network/security-groups"
                    rows={securityGroups}
                    title="Security groups"
                  />
                </div>
              </div>

              <aside className="grid content-start gap-6">
                <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
                  <h2 className="text-lg font-black">Edge and access</h2>
                  <div className="mt-5 divide-y divide-[#e4e9f2]">
                    {edgeResources.map(([label, state, detail, Icon]) => (
                      <div
                        className="flex items-center justify-between gap-4 py-3"
                        key={label}
                      >
                        <span className="flex items-center gap-3 text-sm font-bold text-[#475467]">
                          <Icon className="size-5 text-[#2563eb]" />
                          {label}
                        </span>
                        <span className="text-right text-xs font-black text-[#667085]">
                          {state} · {detail}
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

function ResourceList({
  detailBase,
  rows,
  title,
}: {
  detailBase: string;
  rows: ReadonlyArray<readonly [string, string, string, string, string]>;
  title: string;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
      <div className="border-b border-[#e4e9f2] p-5">
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      <div className="divide-y divide-[#e4e9f2]">
        {rows.map(([name, parent, cidrOrRules, usage, status]) => (
          <Link
            className="grid gap-1 p-4 hover:bg-[#fbfcfe]"
            href={`${detailBase}/${name}`}
            key={name}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-black">{name}</span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-black ${
                  statusClasses[status as keyof typeof statusClasses]
                }`}
              >
                {status}
              </span>
            </div>
            <p className="text-sm font-semibold text-[#667085]">
              {parent} · {cidrOrRules} · {usage}
            </p>
          </Link>
        ))}
      </div>
    </article>
  );
}
