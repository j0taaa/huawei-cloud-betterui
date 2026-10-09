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
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import {
  ConsoleActionGroup,
  ConsoleCallout,
  ConsoleCard,
  ConsoleCatalogCard,
  ConsoleIconTile,
  ConsoleMain,
  ConsoleStatCard,
  ConsoleStatCardGrid,
  ConsoleToolbarButton,
} from "@/components/console-ui";
import { loadCloudSummary } from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

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
      <CloudRefreshIndicator show={summary.isRefreshing} />
      <ConsoleMain>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              Cloud Dashboard
            </h1>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Real Huawei Cloud data for the selected IAM project.
            </p>
          </div>
          <ConsoleActionGroup>
            <RefreshButton />
            <ConsoleToolbarButton disabled>
              <Settings className="size-4" />
              Customize
            </ConsoleToolbarButton>
          </ConsoleActionGroup>
        </div>

        {summary.error || data.errors.length ? (
          <ConsoleCallout tone="warning">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <p>Some Huawei Cloud APIs could not be loaded.</p>
                <p className="mt-1 font-semibold">
                  {[summary.error, ...data.errors].filter(Boolean).join(" ")}
                </p>
              </div>
            </div>
          </ConsoleCallout>
        ) : null}

        <ConsoleStatCardGrid>
          {statCards.map((card) => {
            const Icon = card.icon;
            const value = data[card.key];

            return (
              <ConsoleStatCard
                description={card.detail}
                icon={Icon}
                iconClassName="bg-[#eef4ff] text-[#2563eb]"
                key={card.title}
                title={card.title}
                value={value}
              />
            );
          })}
        </ConsoleStatCardGrid>

        <ConsoleCard>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Infrastructure Overview</h2>
              <p className="mt-1 text-sm font-medium text-[#667085]">
                Showing {summary.isCached ? "cached" : "fresh"} data from{" "}
                <LocalDateTime value={summary.updatedAt} />.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {infrastructure.map(([label, key, href, Icon, color]) => (
              <ConsoleCatalogCard href={href} key={label}>
                <div className="flex items-start gap-4">
                  <ConsoleIconTile className="rounded-full bg-white shadow-sm" size="md">
                    <Icon className={`size-6 ${color}`} />
                  </ConsoleIconTile>
                  <div>
                    <p className="text-sm font-bold text-[#475467]">
                      {label}
                    </p>
                    <p className="mt-1 text-2xl font-black">
                      {data[key]}
                    </p>
                  </div>
                </div>
              </ConsoleCatalogCard>
            ))}
          </div>
        </ConsoleCard>
      </ConsoleMain>
    </ConsoleShell>
  );
}
