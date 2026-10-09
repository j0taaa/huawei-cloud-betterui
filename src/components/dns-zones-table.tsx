"use client";

import { useMemo } from "react";

import {
  CellStack,
  EmptyContent,
  ResourceIdentity,
  StatusBadge,
  type StatusTone,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DeleteDnsZoneButton } from "@/components/dns-zone-actions";
import { LocalDateTime } from "@/components/local-date-time";
import type { DnsZone } from "@/lib/huawei-cloud";

function statusTone(status: string): StatusTone {
  const normalized = status.toLowerCase();

  if (normalized === "active") {
    return "good";
  }

  if (normalized.includes("pending")) {
    return "warn";
  }

  return "neutral";
}

function zoneSearchText(zone: DnsZone) {
  return [
    zone.name,
    zone.id,
    zone.description,
    zone.status,
    zone.projectId,
    zone.projectName,
    zone.region,
    zone.type,
  ]
    .filter(Boolean)
    .join(" ");
}

export function DnsZonesTable({ zones }: { zones: DnsZone[] }) {
  const columns = useMemo(
    (): DataTableColumn<DnsZone>[] => [
      {
        cell: (zone) => (
          <ResourceIdentity
            id={zone.id}
            name={zone.name}
            scope={zone.description || "No description"}
          />
        ),
        header: "Zone",
      },
      {
        cell: (zone) => <StatusBadge tone={statusTone(zone.status)}>{zone.status}</StatusBadge>,
        header: "Status",
      },
      {
        cell: (zone) => zone.recordCount,
        className: "font-black",
        header: "Records",
      },
      {
        cell: (zone) => zone.ttl,
        className: "font-semibold",
        header: "TTL",
      },
      {
        cell: (zone) => (
          <CellStack subValue={zone.region}>
            {zone.projectName || zone.projectId}
          </CellStack>
        ),
        className: "font-semibold",
        header: "Project / region",
      },
      {
        cell: (zone) => <LocalDateTime value={zone.updatedAt || zone.createdAt} />,
        className: "font-semibold",
        header: "Updated",
      },
      {
        cell: (zone) => (
          <div className="text-right">
            <DeleteDnsZoneButton
              recordCount={zone.recordCount}
              zoneId={zone.id}
              zoneName={zone.name}
            />
          </div>
        ),
        header: "Actions",
        headerClassName: "text-right",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No DNS zones found" />}
      getRowKey={(zone) => zone.id}
      getSearchText={zoneSearchText}
      items={zones}
      searchPlaceholder="Search DNS zones"
      tableMinWidthClassName="min-w-[1040px]"
    />
  );
}
