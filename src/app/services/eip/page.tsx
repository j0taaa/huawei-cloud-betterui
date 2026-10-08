import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Globe2 } from "lucide-react";

import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import {
  OperationalTable,
  ReadonlyNetworkingPage,
  ResourceLink,
  StatusBadge,
  StatusSummary,
  valueOrDash,
} from "@/app/services/_components/networking-readonly";

export const metadata: Metadata = {
  title: "EIP | Huawei Cloud Better UI",
};

type EipItem = {
  bandwidthChargeMode?: string;
  bandwidthId?: string;
  bandwidthName?: string;
  bandwidthSize?: string | number;
  id: string;
  ipVersion?: string | number;
  ipAddress?: string;
  name?: string;
  portId?: string;
  privateIpAddress?: string;
  projectId?: string;
  projectName?: string;
  publicIpAddress?: string;
  region?: string;
  status: string;
  type?: string;
};

type CloudModule = Omit<typeof huaweiCloud, "listEips"> & {
  listEips?: (session: BetterUiSession) => Promise<EipItem[]>;
};

const cloud = huaweiCloud as unknown as CloudModule;

async function listEips(session: BetterUiSession) {
  if (typeof cloud.listEips !== "function") {
    throw new Error("Expected @/lib/huawei-cloud to export listEips(session).");
  }

  return cloud.listEips(session);
}

function eipTone(status: string) {
  const normalized = status.toUpperCase();

  if (["ACTIVE", "DOWN"].includes(normalized)) {
    return "good";
  }

  if (["ERROR", "FAULT"].includes(normalized)) {
    return "bad";
  }

  if (normalized.startsWith("PENDING")) {
    return "warn";
  }

  return "neutral";
}

function bandwidthLabel(eip: EipItem) {
  const parts = [
    valueOrDash(eip.bandwidthName),
    eip.bandwidthSize ? `${eip.bandwidthSize} Mbit/s` : "-",
    valueOrDash(eip.bandwidthChargeMode),
  ].filter((part) => part !== "-");

  return parts.length ? parts.join(" / ") : "-";
}

function eipAddress(eip: EipItem) {
  return valueOrDash(eip.publicIpAddress ?? eip.ipAddress);
}

export default async function EipPage() {
  const result = await withCloudResult<EipItem[]>([], listEips, cloudCacheKeys.listEips);
  const eips = result.data;
  const bound = eips.filter((eip) => valueOrDash(eip.portId) !== "-").length;
  const active = eips.filter((eip) => eip.status.toUpperCase() === "ACTIVE").length;

  return (
    <ReadonlyNetworkingPage
      actionLabel="Assign EIP"
      actionTitle="EIP assignment is intentionally not implemented in this read-only view."
      description="Public IP inventory with binding, bandwidth, project, and region context."
      error={result.error}
      icon={Globe2}
      isRefreshing={result.isRefreshing}
      title="Elastic IP"
    >
      <StatusSummary
        items={[
          { label: "Total EIPs", value: eips.length },
          { label: "Active", tone: "good", value: active },
          { label: "Bound", value: bound },
          {
            label: "Unbound",
            tone: bound === eips.length ? "neutral" : "warn",
            value: eips.length - bound,
          },
        ]}
      />

      <OperationalTable
        columns={[
          "Public IP",
          "Status",
          "Binding",
          "Private IP",
          "Bandwidth",
          "Type",
          "Scope",
        ]}
        empty="No elastic IPs found."
        isCached={result.isCached}
        rows={eips.map((eip) => ({
          cells: [
            <ResourceLink key="ip">{eipAddress(eip)}</ResourceLink>,
            <StatusBadge key="status" tone={eipTone(eip.status)}>
              {eip.status}
            </StatusBadge>,
            valueOrDash(eip.portId),
            valueOrDash(eip.privateIpAddress),
            bandwidthLabel(eip),
            [valueOrDash(eip.type), eip.ipVersion ? `IPv${eip.ipVersion}` : "-"]
              .filter((value) => value !== "-")
              .join(" / ") || "-",
            `${valueOrDash(eip.projectName)} / ${valueOrDash(eip.region)}`,
          ],
          id: eip.id,
        }))}
        title="Elastic IP addresses"
        updatedAt={result.updatedAt}
      />
    </ReadonlyNetworkingPage>
  );
}
