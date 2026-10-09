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
import { TaurusDbInstanceActions } from "@/components/taurusdb-instance-actions";
import type { TaurusDbInstance } from "@/lib/huawei-cloud";

function instanceSearchText(instance: TaurusDbInstance) {
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
    instance.readOnlyPrivateIp,
    instance.vpcId,
    instance.subnetId,
    instance.projectName,
    instance.region,
    instance.availabilityZone,
  ]
    .filter(Boolean)
    .join(" ");
}

export function TaurusDbInstancesTable({
  instances,
}: {
  instances: TaurusDbInstance[];
}) {
  const columns = useMemo(
    (): DataTableColumn<TaurusDbInstance>[] => [
      {
        cell: (instance) => (
          <ResourceIdentity
            href={`/services/taurusdb/${instance.id}`}
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
        header: "Engine",
      },
      {
        cell: (instance) => (
          <CellStack subValue={instance.availabilityZone}>
            {instance.nodeCount || "-"} nodes
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
          <CellStack subValue={`Read ${instance.readOnlyPrivateIp} / Port ${instance.port}`}>
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
          <TaurusDbInstanceActions
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
      emptyState={<EmptyContent title="No TaurusDB instances found" />}
      getRowKey={(instance) => instance.id}
      getSearchText={instanceSearchText}
      items={instances}
      searchPlaceholder="Search TaurusDB instances"
      tableMinWidthClassName="min-w-[1240px]"
    />
  );
}
