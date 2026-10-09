"use client";

import { useMemo } from "react";

import {
  CellStack,
  EmptyContent,
  ProjectRegionCell,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EcsInstanceActions } from "@/components/ecs-instance-actions";
import type { EcsInstance } from "@/lib/huawei-cloud";

function instanceSearchText(instance: EcsInstance) {
  return [
    instance.name,
    instance.id,
    instance.status,
    instance.flavor,
    instance.flavorId,
    instance.imageName,
    instance.imageId,
    instance.privateIp,
    instance.publicIp,
    instance.availabilityZone,
    instance.projectId,
    instance.projectName,
    instance.region,
  ]
    .filter(Boolean)
    .join(" ");
}

export function EcsInstancesTable({
  instances,
}: {
  instances: EcsInstance[];
}) {
  const columns = useMemo(
    (): DataTableColumn<EcsInstance>[] => [
      {
        cell: (instance) => (
          <ResourceIdentity
            href={`/services/ecs/${instance.id}`}
            id={instance.id}
            name={instance.name}
          />
        ),
        header: "Name",
      },
      {
        cell: (instance) => <StatusBadge status={instance.status} />,
        header: "Status",
      },
      {
        cell: (instance) => (
          <CellStack
            subValue={
              instance.flavorId !== "-" && instance.flavorId !== instance.flavor
                ? instance.flavorId
                : undefined
            }
          >
            {instance.flavor}
          </CellStack>
        ),
        className: "font-semibold",
        header: "Flavor",
      },
      {
        cell: (instance) => instance.imageName,
        className: "font-semibold",
        header: "Image",
      },
      {
        cell: (instance) => instance.privateIp,
        className: "font-semibold",
        header: "Private IP",
      },
      {
        cell: (instance) => instance.publicIp,
        className: "font-semibold",
        header: "Public IP",
      },
      {
        cell: (instance) => instance.availabilityZone,
        className: "font-semibold",
        header: "AZ",
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
        header: "Project",
      },
      {
        cell: (instance) => (
          <EcsInstanceActions
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
      emptyState={<EmptyContent title="No ECS instances found" />}
      getRowKey={(instance) => instance.id}
      getSearchText={instanceSearchText}
      items={instances}
      searchPlaceholder="Search ECS instances"
      tableMinWidthClassName="min-w-[1120px]"
    />
  );
}
