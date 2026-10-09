"use client";

import { useMemo } from "react";
import { Cable, HardDrive } from "lucide-react";

import {
  CellStack,
  ConsoleMonoText,
  ConsoleUsageCell,
  EmptyContent,
  InlineIconText,
  ProjectRegionCell,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DmsKafkaInstanceActions } from "@/components/dms-kafka-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import type { DmsKafkaInstanceDetails } from "@/lib/huawei-cloud";

function numberFromText(value?: string) {
  const match = value?.match(/[\d.]+/);

  return match ? Number(match[0]) : 0;
}

function instanceSearchText(instance: DmsKafkaInstanceDetails) {
  return [
    instance.name,
    instance.id,
    instance.status,
    instance.engineVersion,
    instance.resourceSpecCode,
    instance.privateConnectAddress,
    instance.connectAddress,
    instance.sslConnectAddress,
    instance.publicConnectAddress,
    instance.vpcName,
    instance.vpcId,
    instance.subnetName,
    instance.subnetId,
    instance.securityGroupName,
    instance.securityGroupId,
    instance.projectName,
    instance.projectId,
    instance.region,
  ]
    .filter(Boolean)
    .join(" ");
}

function StorageGauge({ instance }: { instance: DmsKafkaInstanceDetails }) {
  const total = numberFromText(instance.storage);
  const used = instance.usedStorageGb || numberFromText(instance.usedStorage);
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <ConsoleUsageCell
      detail={`${instance.storage || "-"} total · ${instance.storageSpecCode || "storage spec not reported"}`}
      percent={percent}
      value={`${instance.usedStorage || "-"} used`}
    />
  );
}

export function DmsKafkaInstancesTable({
  instances,
}: {
  instances: DmsKafkaInstanceDetails[];
}) {
  const columns = useMemo(
    (): DataTableColumn<DmsKafkaInstanceDetails>[] => [
      {
        cell: (instance) => (
          <ResourceIdentity
            href={`/services/dms-kafka/${instance.id}`}
            id={instance.id}
            name={instance.name}
            scope={`Kafka ${instance.engineVersion || "-"}`}
          />
        ),
        header: "Instance",
      },
      {
        cell: (instance) => (
          <CellStack
            subValue={(instance.availabilityZones ?? []).join(", ") || "AZ not reported"}
          >
            <StatusBadge status={instance.status || "UNKNOWN"} />
          </CellStack>
        ),
        header: "State",
      },
      {
        cell: (instance) => (
          <>
            <StorageGauge instance={instance} />
            <InlineIconText className="mt-2" icon={HardDrive}>
              {instance.storageType || "storage type not reported"}
            </InlineIconText>
          </>
        ),
        header: "Capacity",
      },
      {
        cell: (instance) => (
          <CellStack subValue={instance.resourceSpecCode || "-"}>
            {instance.brokerCount || "-"} brokers / {instance.partitionNum || "-"} partitions
          </CellStack>
        ),
        className: "font-semibold",
        header: "Brokers",
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
        cell: (instance) => (
          <div>
            <p className="flex items-center gap-1 break-all font-semibold">
              <Cable className="size-3.5 shrink-0 text-[#2563eb]" />
              {instance.privateConnectAddress || instance.connectAddress || "-"}
            </p>
            <ConsoleMonoText className="mt-1 block break-all">
              SSL {instance.sslConnectAddress || "-"}
            </ConsoleMonoText>
            <ConsoleMonoText className="mt-1 block break-all">
              Public {instance.publicConnectAddress || "-"}
            </ConsoleMonoText>
          </div>
        ),
        header: "Endpoints",
      },
      {
        cell: (instance) => (
          <ProjectRegionCell
            projectId={instance.projectId}
            projectName={instance.projectName}
            region={instance.region}
          />
        ),
        className: "font-semibold",
        header: "Project / region",
      },
      {
        cell: (instance) => <LocalDateTime value={instance.createdAt || ""} />,
        className: "font-semibold",
        header: "Created",
      },
      {
        cell: (instance) => (
          <DmsKafkaInstanceActions
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
      emptyState={<EmptyContent title="No DMS Kafka instances found" />}
      getRowKey={(instance) => instance.id}
      getSearchText={instanceSearchText}
      items={instances}
      searchPlaceholder="Search Kafka instances"
      tableMinWidthClassName="min-w-[1420px]"
    />
  );
}
