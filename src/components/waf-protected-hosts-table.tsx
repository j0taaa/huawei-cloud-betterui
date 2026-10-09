"use client";

import { Globe2, Layers3, Network, ShieldCheck } from "lucide-react";

import { CellStack, EmptyContent, ResourceIdentity, StatusBadge, type StatusTone } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";

export type WafProtectedHost = {
  accessCode?: string;
  accessStatus?: string;
  action?: string;
  createdAt?: string;
  hostname?: string;
  id?: string;
  mode?: string;
  policyId?: string;
  policyLevel?: string;
  policyName?: string;
  projectId?: string;
  projectName?: string;
  protectStatus?: string;
  protectedFeatures?: string[];
  proxy?: string;
  region?: string;
  serverCount?: number;
};

type WafProtectedHostsTableProps = {
  instances: WafProtectedHost[];
};

export function wafHostAction(instance: WafProtectedHost) {
  return instance.action || instance.protectStatus || instance.accessStatus || "Unknown";
}

function statusTone(value: string): StatusTone {
  const normalized = value.toLowerCase();

  if (normalized === "block" || normalized === "enabled" || normalized === "1") {
    return "good";
  }

  if (normalized === "log" || normalized === "0" || normalized === "disabled") {
    return "warn";
  }

  return "neutral";
}

function levelTone(level: string): StatusTone {
  const normalized = level.toLowerCase();

  if (normalized === "strict" || normalized === "3") {
    return "good";
  }

  if (normalized === "low" || normalized === "1") {
    return "warn";
  }

  return "neutral";
}

function enabledFeatureCount(instance: WafProtectedHost) {
  return (instance.protectedFeatures ?? []).filter(Boolean).length;
}

const columns: DataTableColumn<WafProtectedHost>[] = [
  {
    cell: (instance) => (
      <ResourceIdentity
        id={instance.id || "-"}
        name={instance.hostname || "-"}
        scope={instance.createdAt ? `Added ${instance.createdAt}` : "Created time not returned"}
      />
    ),
    header: "Host",
  },
  {
    cell: (instance) => (
      <CellStack subValue={`Access ${instance.accessStatus || "-"}`}>
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-[#16a34a]" />
          <StatusBadge tone={statusTone(wafHostAction(instance))}>{wafHostAction(instance)}</StatusBadge>
        </span>
      </CellStack>
    ),
    header: "Protection",
  },
  {
    cell: (instance) => (
      <CellStack
        subValue={
          <span className="break-all text-[#98a2b3]">
            {instance.policyId || "-"}
          </span>
        }
      >
        <span className="font-black">{instance.policyName || "Policy ID"}</span>
        <span className="mt-2 block">
          <StatusBadge tone={levelTone(instance.policyLevel ?? "")}>
            Level {instance.policyLevel || "not returned"}
          </StatusBadge>
        </span>
      </CellStack>
    ),
    header: "Policy",
  },
  {
    cell: (instance) => (
      <CellStack
        subValue={
          instance.protectedFeatures?.length
            ? instance.protectedFeatures.join(", ")
            : "Policy option details not returned by loader"
        }
      >
        <span className="inline-flex items-center gap-2 font-black">
          <Layers3 className="size-4 text-[#7c3aed]" />
          {enabledFeatureCount(instance)} controls enabled
        </span>
      </CellStack>
    ),
    header: "Controls",
  },
  {
    cell: (instance) => (
      <CellStack subValue={`${instance.serverCount ?? "-"} origin servers · ${instance.mode || "cloud"} mode`}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <Network className="size-4 text-[#2563eb]" />
          Proxy {instance.proxy || "-"}
        </span>
      </CellStack>
    ),
    header: "Origin path",
  },
  {
    cell: (instance) => (
      <CellStack subValue={instance.region || "-"}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <Globe2 className="size-4 text-[#ea580c]" />
          {instance.projectName || instance.projectId || "-"}
        </span>
      </CellStack>
    ),
    header: "Project",
  },
];

export function WafProtectedHostsTable({ instances }: WafProtectedHostsTableProps) {
  return (
    <DataTable
      columns={columns}
      emptyState={
        <EmptyContent title="No WAF protected hosts found">
          No protected WAF hosts were returned, or the signed-in principal cannot list WAF protected domains in the selected projects.
        </EmptyContent>
      }
      getRowKey={(instance) => `${instance.projectId ?? "project"}:${instance.id ?? instance.hostname ?? "host"}`}
      getSearchText={(instance) =>
        `${instance.hostname} ${instance.id} ${instance.createdAt} ${wafHostAction(instance)} ${instance.accessStatus} ${instance.policyName} ${instance.policyId} ${instance.policyLevel} ${instance.protectedFeatures?.join(" ")} ${instance.proxy} ${instance.mode} ${instance.projectName} ${instance.projectId} ${instance.region}`
      }
      items={instances}
      searchPlaceholder="Search hosts, policies, controls, projects, or regions"
      tableMinWidthClassName="min-w-[1120px]"
    />
  );
}
