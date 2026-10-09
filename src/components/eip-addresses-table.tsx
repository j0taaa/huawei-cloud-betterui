"use client";

import { useMemo } from "react";

import {
  CellStack,
  EmptyContent,
  StatusBadge,
  type StatusTone,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ReleaseEipButton } from "@/components/eip-actions";
import { LocalDateTime } from "@/components/local-date-time";
import type { EipItem } from "@/lib/huawei-cloud";

export function valueOrDash(value: unknown) {
  if (typeof value === "string") {
    return value.trim() || "-";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return "-";
}

function eipTone(status: string): StatusTone {
  const normalized = status.toUpperCase();

  if (["ACTIVE", "ELB", "VPN"].includes(normalized)) {
    return "good";
  }

  if (["ERROR", "FAULT", "BIND_ERROR", "FREEZED"].includes(normalized)) {
    return "bad";
  }

  if (normalized.startsWith("PENDING") || normalized.startsWith("NOTIFY")) {
    return "warn";
  }

  return "neutral";
}

export function isEipReleaseAllowed(eip: EipItem) {
  return (
    eip.status.toUpperCase() === "DOWN" &&
    !eip.portId &&
    !eip.associatedInstanceId
  );
}

function releaseDisabledReason(eip: EipItem) {
  if (isEipReleaseAllowed(eip)) {
    return undefined;
  }

  if (eip.status.toUpperCase() !== "DOWN") {
    return "Only DOWN, unbound EIPs can be released.";
  }

  return "Unbind this EIP before releasing it.";
}

function bandwidthLabel(eip: EipItem) {
  return [
    valueOrDash(eip.bandwidthName),
    valueOrDash(eip.bandwidthSize),
    valueOrDash(eip.bandwidthChargeMode),
  ].filter((value) => value !== "-").join(" / ") || "-";
}

function bindingLabel(eip: EipItem) {
  const type = valueOrDash(eip.associatedInstanceType);
  const id = valueOrDash(eip.associatedInstanceId || eip.portId);

  if (type === "-" && id === "-") {
    return "Unbound";
  }

  return [type, id].filter((value) => value !== "-").join(" / ");
}

export function eipAddress(eip: EipItem) {
  return valueOrDash(eip.ipAddress !== "-" ? eip.ipAddress : eip.publicIpv6Address);
}

function eipSearchText(eip: EipItem) {
  return [
    eipAddress(eip),
    eip.name,
    eip.id,
    eip.status,
    eip.associatedInstanceId,
    eip.associatedInstanceType,
    eip.privateIpAddress,
    eip.bandwidthName,
    eip.bandwidthId,
    eip.type,
    eip.networkType,
    eip.projectName,
    eip.projectId,
    eip.region,
  ]
    .filter(Boolean)
    .join(" ");
}

export function EipAddressesTable({ eips }: { eips: EipItem[] }) {
  const columns = useMemo(
    (): DataTableColumn<EipItem>[] => [
      {
        cell: (eip) => (
          <>
            <div className="font-black text-[#101828]">{eipAddress(eip)}</div>
            <div className="mt-1 break-all text-xs font-bold text-[#667085]">
              {valueOrDash(eip.name)}
            </div>
          </>
        ),
        header: "Address",
      },
      {
        cell: (eip) => (
          <CellStack subValue={eip.lockStatus !== "-" ? eip.lockStatus : undefined}>
            <StatusBadge tone={eipTone(eip.status)}>{eip.status}</StatusBadge>
          </CellStack>
        ),
        header: "Status",
      },
      {
        cell: (eip) => (
          <CellStack subValue={`Private: ${valueOrDash(eip.privateIpAddress)}`}>
            <span className="break-all">{bindingLabel(eip)}</span>
          </CellStack>
        ),
        className: "max-w-[260px] font-semibold text-[#344054]",
        header: "Binding",
      },
      {
        cell: (eip) => (
          <CellStack subValue={valueOrDash(eip.bandwidthId)}>
            {bandwidthLabel(eip)}
          </CellStack>
        ),
        className: "max-w-[240px] font-semibold text-[#344054]",
        header: "Bandwidth",
      },
      {
        cell: (eip) => (
          <CellStack subValue={`${valueOrDash(eip.networkType)} / ${valueOrDash(eip.publicBorderGroup)}`}>
            {valueOrDash(eip.type)} / IPv{valueOrDash(eip.ipVersion)}
          </CellStack>
        ),
        className: "font-semibold text-[#344054]",
        header: "Network",
      },
      {
        cell: (eip) => (
          <CellStack subValue={`EPS: ${valueOrDash(eip.enterpriseProjectId)}`}>
            <span className="break-all">{valueOrDash(eip.billingInfo)}</span>
          </CellStack>
        ),
        className: "max-w-[220px] font-semibold text-[#344054]",
        header: "Billing",
      },
      {
        cell: (eip) => (
          <CellStack subValue={valueOrDash(eip.region)}>
            {valueOrDash(eip.projectName)}
          </CellStack>
        ),
        className: "font-semibold text-[#344054]",
        header: "Scope",
      },
      {
        cell: (eip) =>
          eip.createdAt !== "-" ? <LocalDateTime value={eip.createdAt} /> : "-",
        className: "font-semibold text-[#344054]",
        header: "Created",
      },
      {
        cell: (eip) => (
          <ReleaseEipButton
            disabledReason={releaseDisabledReason(eip)}
            ipAddress={eipAddress(eip)}
            name={valueOrDash(eip.name)}
            projectId={eip.projectId}
            publicIpId={eip.id}
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
      emptyState={<EmptyContent title="No elastic IPs found." />}
      getRowKey={(eip) => eip.id}
      getSearchText={eipSearchText}
      items={eips}
      searchPlaceholder="Search EIPs"
      tableMinWidthClassName="min-w-[1160px]"
    />
  );
}
