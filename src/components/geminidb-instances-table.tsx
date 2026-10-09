"use client";

import { useMemo } from "react";

import {
  BackupRetentionCell,
  CellStack,
  EmptyContent,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { GeminiDbInstanceActions } from "@/components/geminidb-instance-actions";
import type { GeminiDbInstance } from "@/lib/huawei-cloud";

function endpoint(instance: GeminiDbInstance) {
  if (instance.lbIpAddress !== "-") {
    return `${instance.lbIpAddress}:${instance.lbPort}`;
  }

  return instance.privateIp;
}

function instanceSearchText(instance: GeminiDbInstance) {
  return [
    instance.name,
    instance.id,
    instance.status,
    instance.apiType,
    instance.datastore,
    instance.engine,
    instance.mode,
    instance.storage,
    instance.volumeUsed,
    instance.privateIp,
    instance.lbIpAddress,
    instance.vpcId,
    instance.subnetId,
    instance.projectName,
    instance.region,
    instance.availabilityZone,
  ]
    .filter(Boolean)
    .join(" ");
}

export function GeminiDbInstancesTable({
  instances,
}: {
  instances: GeminiDbInstance[];
}) {
  const columns = useMemo(
    (): DataTableColumn<GeminiDbInstance>[] => [
      {
        cell: (instance) => (
          <ResourceIdentity
            href={`/services/geminidb/${instance.id}`}
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
          <CellStack subValue={`${instance.datastore} / ${instance.engine}`}>
            {instance.apiType}
          </CellStack>
        ),
        className: "font-bold",
        header: "API",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`${instance.mode} / ${instance.availabilityZone}`}>
            {instance.groupCount || "-"} groups / {instance.nodeCount || "-"} nodes
          </CellStack>
        ),
        className: "font-bold",
        header: "Topology",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`Used ${instance.volumeUsed}`}>
            {instance.storage}
          </CellStack>
        ),
        className: "font-bold",
        header: "Storage",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`Port ${instance.lbPort !== "-" ? instance.lbPort : "-"}`}>
            {endpoint(instance)}
          </CellStack>
        ),
        className: "font-bold",
        header: "Endpoint",
      },
      {
        cell: (instance) => (
          <CellStack subValue={`Subnet ${instance.subnetId}`}>
            <span className="break-all">VPC {instance.vpcId}</span>
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
          <GeminiDbInstanceActions
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
      emptyState={<EmptyContent title="No GeminiDB instances found" />}
      getRowKey={(instance) => instance.id}
      getSearchText={instanceSearchText}
      items={instances}
      searchPlaceholder="Search GeminiDB instances"
      tableMinWidthClassName="min-w-[1320px]"
    />
  );
}
