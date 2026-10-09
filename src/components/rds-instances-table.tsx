"use client";

import { useMemo } from "react";

import {
  BackupRetentionCell,
  CellStack,
  EmptyContent,
  ResourceIdentity,
  StorageCell,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { RdsInstanceActions } from "@/components/rds-instance-actions";
import type { RdsInstance } from "@/lib/huawei-cloud";

function instanceSearchText(instance: RdsInstance) {
  return [
    instance.name,
    instance.id,
    instance.status,
    instance.datastore,
    instance.type,
    instance.mode,
    instance.storage,
    instance.storageType,
    instance.privateIp,
    instance.port,
    instance.projectName,
    instance.region,
    instance.availabilityZone,
  ]
    .filter(Boolean)
    .join(" ");
}

export function RdsInstancesTable({ instances }: { instances: RdsInstance[] }) {
  const columns = useMemo(
    (): DataTableColumn<RdsInstance>[] => [
      {
        cell: (instance) => (
          <ResourceIdentity
            href={`/services/rds/${instance.id}`}
            id={instance.id}
            name={instance.name}
            scope={`${instance.projectName} / ${instance.region}`}
          />
        ),
        header: "Instance",
      },
      {
        cell: (instance) => <StatusBadge status={instance.status} />,
        header: "Status",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`${instance.type} / ${instance.mode}`}>
            {instance.datastore}
          </CellStack>
        ),
        className: "font-bold",
        header: "Datastore",
      },
      {
        cell: (instance) => (
          <CellStack subValue={instance.availabilityZone}>
            {instance.nodes.length || "-"} nodes
          </CellStack>
        ),
        className: "font-bold",
        header: "Topology",
      },
      {
        cell: (instance) => (
          <StorageCell storage={instance.storage} storageType={instance.storageType} />
        ),
        className: "font-bold",
        header: "Storage",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`Port ${instance.port}`}>
            {instance.privateIp}
          </CellStack>
        ),
        className: "font-bold",
        header: "Network",
      },
      {
        cell: (instance) => (
          <BackupRetentionCell
            backupWindow={instance.backupWindow}
            keepDays={instance.backupKeepDays}
          />
        ),
        className: "font-bold",
        header: "Backup",
      },
      {
        cell: (instance) => (
          <RdsInstanceActions
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
      emptyState={<EmptyContent title="No RDS instances found" />}
      getRowKey={(instance) => instance.id}
      getSearchText={instanceSearchText}
      items={instances}
      searchPlaceholder="Search RDS instances"
      tableMinWidthClassName="min-w-[1180px]"
    />
  );
}
