"use client";

import { useMemo } from "react";

import {
  CellStack,
  ConsoleUsageCell,
  EmptyContent,
  ProjectRegionCell,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";
import {
  DeleteSfsShareButton,
  ManageSfsAclButton,
} from "@/components/sfs-share-actions";
import type { SfsShare } from "@/lib/huawei-cloud";

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function shareSearchText(share: SfsShare) {
  return [
    share.name,
    share.id,
    share.description,
    share.status,
    share.protocol,
    share.exportLocation,
    share.availabilityZone,
    share.projectName,
    share.projectId,
    share.region,
    share.shareType,
  ]
    .filter(Boolean)
    .join(" ");
}

export function SfsSharesTable({ shares }: { shares: SfsShare[] }) {
  const columns = useMemo(
    (): DataTableColumn<SfsShare>[] => [
      {
        cell: (share) => (
          <ResourceIdentity
            id={share.id}
            name={share.name}
            scope={share.shareType || "Default share type"}
          />
        ),
        header: "File system",
      },
      {
        cell: (share) => (
          <CellStack subValue={share.isPublic ? "Public" : "Private"}>
            <StatusBadge status={share.status || "UNKNOWN"} />
          </CellStack>
        ),
        header: "Status",
      },
      {
        cell: (share) => (
          <CellStack subValue={share.exportLocation || "Mount path not returned"}>
            {share.protocol || "-"}
          </CellStack>
        ),
        className: "font-bold",
        header: "Protocol / export",
      },
      {
        cell: (share) => {
          const usedPercent =
            share.sizeGb > 0
              ? Math.min(100, (share.usedBytes / (share.sizeGb * 1024 ** 3)) * 100)
              : 0;

          return (
            <ConsoleUsageCell
              className="min-w-28"
              detail={`${formatBytes(share.usedBytes)} used`}
              percent={usedPercent}
              tone="green"
              value={`${share.sizeGb} GiB`}
            />
          );
        },
        header: "Size",
      },
      {
        cell: (share) => (
          <CellStack subValue={share.region}>{share.availabilityZone || "-"}</CellStack>
        ),
        className: "font-bold",
        header: "AZ / region",
      },
      {
        cell: (share) => (
          <ProjectRegionCell
            projectId={share.projectId}
            projectName={share.projectName}
          />
        ),
        className: "font-bold",
        header: "Project",
      },
      {
        cell: (share) => <LocalDateTime value={share.createdAt} />,
        className: "font-bold",
        header: "Created",
      },
      {
        cell: (share) => (
          <div className="flex flex-wrap gap-2">
            <ManageSfsAclButton
              projectId={share.projectId}
              shareId={share.id}
              shareName={share.name}
            />
            <DeleteSfsShareButton
              projectId={share.projectId}
              shareId={share.id}
              shareName={share.name}
              status={share.status}
            />
          </div>
        ),
        header: "Actions",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No SFS file systems found" />}
      getRowKey={(share) => share.id}
      getSearchText={shareSearchText}
      items={shares}
      searchPlaceholder="Search file systems"
      tableMinWidthClassName="min-w-[1040px]"
    />
  );
}
