"use client";

import { useMemo } from "react";
import { Gauge, KeyRound } from "lucide-react";

import {
  CellStack,
  ConsoleUsageCell,
  EmptyContent,
  InlineIconText,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DcsInstanceActions } from "@/components/dcs-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import type { DcsRedisInstanceDetails } from "@/lib/huawei-cloud";

function instanceSearchText(instance: DcsRedisInstanceDetails) {
  return [
    instance.name,
    instance.id,
    instance.status,
    instance.engine,
    instance.engineVersion,
    instance.mode,
    instance.resourceSpecCode,
    instance.connectionAddress,
    instance.ip,
    instance.vpcId,
    instance.vpcName,
    instance.subnetId,
    instance.subnetName,
    instance.securityGroupId,
    instance.securityGroupName,
    instance.projectId,
    instance.projectName,
    instance.region,
  ]
    .filter(Boolean)
    .join(" ");
}

function MemoryGauge({ instance }: { instance: DcsRedisInstanceDetails }) {
  const percent =
    instance.maxMemoryMb > 0
      ? Math.min(100, Math.round((instance.usedMemoryMb / instance.maxMemoryMb) * 100))
      : 0;

  return (
    <ConsoleUsageCell
      detail={`${instance.maxMemory || instance.capacity || "-"} available`}
      percent={percent}
      tone="green"
      value={`${instance.usedMemory || "-"} used`}
    />
  );
}

export function DcsInstancesTable({
  instances,
}: {
  instances: DcsRedisInstanceDetails[];
}) {
  const columns = useMemo(
    (): DataTableColumn<DcsRedisInstanceDetails>[] => [
      {
        cell: (instance) => (
          <ResourceIdentity
            href={`/services/dcs/${instance.id}`}
            id={instance.id}
            name={instance.name}
            scope={`${instance.engine || "Redis"} ${instance.engineVersion || "-"}`}
          />
        ),
        header: "Instance",
      },
      {
        cell: (instance) => (
          <CellStack subValue={instance.chargingMode || "Billing mode not reported"}>
            <StatusBadge status={instance.status || "UNKNOWN"} />
          </CellStack>
        ),
        header: "State",
      },
      {
        cell: (instance) => <MemoryGauge instance={instance} />,
        header: "Memory",
      },
      {
        cell: (instance) => (
          <div className="font-semibold">
            <InlineIconText
              className="text-sm font-semibold text-[#101828] dark:text-white"
              icon={Gauge}
              iconClassName="text-[#15803d] dark:text-[#86efac]"
            >
              {instance.mode || instance.resourceSpecCode || "-"}
            </InlineIconText>
            <p className="mt-1">{instance.nodeCount ?? "-"} nodes</p>
            <p className="mt-1 text-xs text-[#667085]">
              {(instance.availabilityZones ?? []).join(", ") || "AZ not reported"}
            </p>
          </div>
        ),
        header: "Topology",
      },
      {
        cell: (instance) => (
          <CellStack
            subValue={
              <InlineIconText icon={KeyRound}>
                Port {instance.port || "-"}
              </InlineIconText>
            }
          >
            <span className="break-all">
              {instance.connectionAddress || instance.ip || "-"}
            </span>
          </CellStack>
        ),
        className: "font-semibold",
        header: "Endpoint",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`Subnet ${instance.subnetName || instance.subnetId || "-"}`}>
            VPC {instance.vpcName || instance.vpcId || "-"}
          </CellStack>
        ),
        className: "font-semibold",
        header: "Network",
      },
      {
        cell: (instance) => <LocalDateTime value={instance.createdAt || ""} />,
        className: "font-semibold",
        header: "Created",
      },
      {
        cell: (instance) => (
          <DcsInstanceActions
            engineVersion={instance.engineVersion}
            id={instance.id}
            projectId={instance.projectId}
            status={instance.status}
          />
        ),
        header: "Actions",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No DCS Redis instances found" />}
      getRowKey={(instance) => instance.id}
      getSearchText={instanceSearchText}
      items={instances}
      searchPlaceholder="Search Redis instances"
      tableMinWidthClassName="min-w-[1320px]"
    />
  );
}
