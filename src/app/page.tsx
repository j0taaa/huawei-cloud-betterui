import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  Database,
  HardDrive,
  Network,
  Server,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { loadCloudSummary } from "@/lib/huawei-cloud";

const statCards = [
  {
    detail: "Running ECS instances",
    icon: Server,
    key: "ecsRunning",
    title: "Running Instances",
  },
  {
    detail: "Attached and available disks",
    icon: HardDrive,
    key: "evsDisks",
    title: "EVS Disks",
  },
  {
    detail: "VPCs in selected project",
    icon: Network,
    key: "vpcs",
    title: "VPC Networks",
  },
  {
    detail: "Managed database instances",
    icon: Database,
    key: "rdsInstances",
    title: "RDS Instances",
  },
] as const;

const infrastructure = [
  ["ECS Instances", "ecsInstances", "/services/ecs", Server, "text-[#2563eb]"],
  ["EVS Disks", "evsDisks", "/services/evs", HardDrive, "text-[#16a34a]"],
  ["VPCs", "vpcs", "/services/network", Network, "text-[#0891b2]"],
  ["Subnets", "subnets", "/services/network", Boxes, "text-[#9333ea]"],
  ["Security Groups", "securityGroups", "/services/network", ShieldCheck, "text-[#dc2626]"],
  ["Load Balancers", "elbLoadBalancers", "/services/elb", Boxes, "text-[#4f46e5]"],
  ["CCE Clusters", "cceClusters", "/services/cce", Boxes, "text-[#0f766e]"],
  ["RDS Instances", "rdsInstances", "/services/rds", Database, "text-[#9333ea]"],
] as const;

export default async function Home() {
  const summary = await loadCloudSummary();
  const data = summary.data;

  return (
    <ConsoleShell active="Dashboard">
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              Cloud Dashboard
            </h1>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Real Huawei Cloud data for the selected IAM project.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <RefreshButton />
            <button
              className="flex h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold text-[#98a2b3] shadow-sm"
              disabled
              type="button"
            >
              <Settings className="size-4" />
              Customize
            </button>
          </div>
        </div>

        {summary.error || data.errors.length ? (
          <section className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-sm font-bold text-[#9a3412]">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <p>Some Huawei Cloud APIs could not be loaded.</p>
                <p className="mt-1 font-semibold">
                  {[summary.error, ...data.errors].filter(Boolean).join(" ")}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            const value = data[card.key];

            return (
              <article
                className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
                key={card.title}
              >
                <div className="grid size-12 place-items-center rounded-full bg-[#eef4ff] text-[#2563eb]">
                  <Icon className="size-6" />
                </div>
                <p className="mt-5 text-sm font-bold text-[#344054]">
                  {card.title}
                </p>
                <p className="mt-1 text-3xl font-black tracking-tight">
                  {value}
                </p>
                <p className="mt-3 text-sm font-medium text-[#667085]">
                  {card.detail}
                </p>
              </article>
            );
          })}
        </section>

        <section className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Infrastructure Overview</h2>
              <p className="mt-1 text-sm font-medium text-[#667085]">
                Last refreshed {new Date(summary.updatedAt).toLocaleString()}.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {infrastructure.map(([label, key, href, Icon, color]) => (
              <Link
                className="rounded-lg border border-[#e4e9f2] bg-[#fbfcfe] p-4 transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(16,24,40,0.08)]"
                href={href}
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
                    <p className="mt-1 text-2xl font-black">
                      {data[key]}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}
