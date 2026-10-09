"use client";

import { useMemo } from "react";
import { Cpu, MapPin } from "lucide-react";

import {
  CellStack,
  EmptyContent,
  InlineIconText,
  ProjectRegionCell,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import type { CceCluster } from "@/lib/huawei-cloud";

function clusterSearchText(cluster: CceCluster) {
  return [
    cluster.name,
    cluster.id,
    cluster.status,
    cluster.version,
    cluster.flavor,
    cluster.type,
    cluster.region,
    cluster.projectName,
    cluster.projectId,
    cluster.vpcId,
    cluster.subnetId,
  ]
    .filter(Boolean)
    .join(" ");
}

export function CceClustersTable({ clusters }: { clusters: CceCluster[] }) {
  const columns = useMemo(
    (): DataTableColumn<CceCluster>[] => [
      {
        cell: (cluster) => (
          <ResourceIdentity
            href={`/services/cce/${cluster.id}`}
            id={cluster.id}
            name={cluster.name}
          />
        ),
        header: "Name",
      },
      {
        cell: (cluster) => <StatusBadge status={cluster.status} />,
        header: "Status",
      },
      {
        cell: (cluster) => cluster.version,
        className: "font-bold",
        header: "Version",
      },
      {
        cell: (cluster) =>
          cluster.activeNodes || cluster.nodeCount
            ? `${cluster.activeNodes}/${cluster.nodeCount}`
            : "-",
        className: "font-bold",
        header: "Nodes",
      },
      {
        cell: (cluster) => (
          <CellStack subValue={cluster.type}>{cluster.flavor}</CellStack>
        ),
        className: "font-bold",
        header: "Flavor",
      },
      {
        cell: (cluster) => (
          <div>
            <InlineIconText
              className="text-sm font-bold text-[#101828] dark:text-white"
              icon={MapPin}
            >
              {cluster.region}
            </InlineIconText>
            <InlineIconText className="mt-1 text-[#98a2b3]" icon={Cpu}>
              {cluster.totalCpu} · {cluster.totalMemory}
            </InlineIconText>
          </div>
        ),
        header: "Network",
      },
      {
        cell: (cluster) => (
          <ProjectRegionCell
            projectId={cluster.projectId}
            projectName={cluster.projectName}
          />
        ),
        className: "font-bold",
        header: "Project",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No CCE clusters found" />}
      getRowKey={(cluster) => cluster.id}
      getSearchText={clusterSearchText}
      items={clusters}
      searchPlaceholder="Search CCE clusters"
      tableMinWidthClassName="min-w-[1120px]"
    />
  );
}
