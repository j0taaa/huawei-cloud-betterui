"use client";

import { Globe2, Network, ServerCog, ShieldAlert } from "lucide-react";

import { CellStack, EmptyContent, ResourceIdentity, StatusBadge, type StatusTone } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";

export type HssHostRow = {
  agentStatus?: string;
  baselineRiskCount?: number;
  detectResult?: string;
  groupName?: string;
  id?: string;
  intrusionCount?: number;
  name?: string;
  os?: string;
  policyGroupName?: string;
  privateIp?: string;
  projectId?: string;
  projectName?: string;
  publicIp?: string;
  region?: string;
  riskCount?: number;
  version?: string;
  vulnerabilityCount?: number;
};

type HssHostsTableProps = {
  hosts: HssHostRow[];
};

function agentTone(status: string): StatusTone {
  const normalized = status.toLowerCase();

  if (normalized === "online") {
    return "good";
  }

  if (normalized === "offline" || normalized === "install_failed") {
    return "bad";
  }

  if (normalized === "not_installed") {
    return "warn";
  }

  return "neutral";
}

function detectionTone(result: string): StatusTone {
  const normalized = result.toLowerCase();

  if (normalized === "clean") {
    return "good";
  }

  if (normalized === "risk") {
    return "bad";
  }

  return normalized === "scanning" ? "warn" : "neutral";
}

function riskTone(count: number): StatusTone {
  return count > 0 ? "bad" : "good";
}

const columns: DataTableColumn<HssHostRow>[] = [
  {
    cell: (host) => (
      <ResourceIdentity
        id={host.id || "-"}
        name={host.name || "-"}
        scope={
          <span>
            {host.privateIp || "-"} private · {host.publicIp || "-"} public · {host.os || "-"}
          </span>
        }
      />
    ),
    header: "Host",
  },
  {
    cell: (host) => (
      <CellStack subValue={`Edition ${host.version || "-"}`}>
        <span className="inline-flex items-center gap-2">
          <ServerCog className="size-4 text-[#2563eb]" />
          <StatusBadge tone={agentTone(host.agentStatus ?? "")}>{host.agentStatus || "Unknown"}</StatusBadge>
        </span>
      </CellStack>
    ),
    header: "Agent",
  },
  {
    cell: (host) => (
      <span className="inline-flex items-center gap-2">
        <ShieldAlert className="size-4 text-[#ea580c]" />
        <StatusBadge tone={detectionTone(host.detectResult ?? "")}>{host.detectResult || "Unknown"}</StatusBadge>
      </span>
    ),
    header: "Detection",
  },
  {
    cell: (host) => (
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={riskTone(host.vulnerabilityCount ?? 0)}>{host.vulnerabilityCount ?? 0} vul</StatusBadge>
        <StatusBadge tone={riskTone(host.baselineRiskCount ?? 0)}>{host.baselineRiskCount ?? 0} baseline</StatusBadge>
        <StatusBadge tone={riskTone(host.intrusionCount ?? 0)}>{host.intrusionCount ?? 0} intrusion</StatusBadge>
      </div>
    ),
    header: "Risk counts",
  },
  {
    cell: (host) => (
      <CellStack subValue={`Group ${host.groupName || "-"}`}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <Network className="size-4 text-[#7c3aed]" />
          {host.policyGroupName || "-"}
        </span>
      </CellStack>
    ),
    header: "Policy",
  },
  {
    cell: (host) => (
      <CellStack subValue={host.region || "-"}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <Globe2 className="size-4 text-[#16a34a]" />
          {host.projectName || host.projectId || "-"}
        </span>
      </CellStack>
    ),
    header: "Project",
  },
];

export function HssHostsTable({ hosts }: HssHostsTableProps) {
  return (
    <DataTable
      columns={columns}
      emptyState={
        <EmptyContent title="No HSS hosts found">
          No HSS hosts were returned. Verify HSS has access to server assets and that the current IAM principal can query Host Security Service.
        </EmptyContent>
      }
      getRowKey={(host) => `${host.projectId ?? "project"}:${host.id ?? host.name ?? "host"}`}
      getSearchText={(host) =>
        `${host.name} ${host.id} ${host.privateIp} ${host.publicIp} ${host.os} ${host.agentStatus} ${host.version} ${host.detectResult} ${host.policyGroupName} ${host.groupName} ${host.projectName} ${host.projectId} ${host.region}`
      }
      items={hosts}
      searchPlaceholder="Search hosts, IPs, policies, projects, or agent status"
      tableMinWidthClassName="min-w-[1160px]"
    />
  );
}
