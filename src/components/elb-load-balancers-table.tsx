"use client";

import { useMemo } from "react";

import {
  CellStack,
  EmptyContent,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import type { ElbItem } from "@/lib/huawei-cloud";

function elbSearchText(elb: ElbItem) {
  return [
    elb.name,
    elb.id,
    elb.vipAddress,
    elb.operatingStatus,
    elb.provisioningStatus,
    elb.region,
    elb.projectName,
    elb.projectId,
    elb.flavor,
    ...elb.availabilityZones,
    ...elb.eips,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ElbLoadBalancersTable({
  loadBalancers,
}: {
  loadBalancers: ElbItem[];
}) {
  const columns = useMemo(
    (): DataTableColumn<ElbItem>[] => [
      {
        cell: (elb) => (
          <ResourceIdentity
            href={`/services/elb/${elb.id}`}
            id={elb.id}
            name={elb.name}
          />
        ),
        header: "Name",
      },
      {
        cell: (elb) => elb.vipAddress || "-",
        className: "font-semibold",
        header: "VIP",
      },
      {
        cell: (elb) => <StatusBadge status={elb.operatingStatus} />,
        header: "Operating",
      },
      {
        cell: (elb) => <StatusBadge status={elb.provisioningStatus} />,
        header: "Provisioning",
      },
      {
        cell: (elb) => String(elb.listenerCount),
        className: "font-semibold",
        header: "Listeners",
      },
      {
        cell: (elb) => String(elb.backendPoolCount),
        className: "font-semibold",
        header: "Backend pools",
      },
      {
        cell: (elb) => (
          <CellStack subValue={elb.projectName}>{elb.region}</CellStack>
        ),
        className: "font-semibold",
        header: "Region / project",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No load balancers found." />}
      getRowKey={(elb) => elb.id}
      getSearchText={elbSearchText}
      items={loadBalancers}
      searchPlaceholder="Search load balancers"
      tableMinWidthClassName="min-w-[1120px]"
    />
  );
}
