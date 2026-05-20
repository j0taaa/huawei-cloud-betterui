import type { Metadata } from "next";
import { Router } from "lucide-react";

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
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = {
  title: "NAT Gateway | Huawei Cloud Better UI",
};

type NatGatewayItem = {
  createdAt?: string;
  description?: string;
  enterpriseProjectId?: string;
  id: string;
  name: string;
  projectId?: string;
  projectName?: string;
  region?: string;
  routerId?: string;
  spec?: string;
  status: string;
  subnetId?: string;
  type?: string;
  vpcId?: string;
};

type CloudModule = Omit<typeof huaweiCloud, "listNatGateways"> & {
  listNatGateways?: (session: BetterUiSession) => Promise<NatGatewayItem[]>;
};

const cloud = huaweiCloud as unknown as CloudModule;

async function listNatGateways(session: BetterUiSession) {
  if (typeof cloud.listNatGateways !== "function") {
    throw new Error("Expected @/lib/huawei-cloud to export listNatGateways(session).");
  }

  return cloud.listNatGateways(session);
}

function natTone(status: string) {
  const normalized = status.toUpperCase();

  if (["ACTIVE", "RUNNING"].includes(normalized)) {
    return "good";
  }

  if (["ERROR", "FAULT", "FROZEN"].includes(normalized)) {
    return "bad";
  }

  if (normalized.startsWith("PENDING") || normalized === "CREATING") {
    return "warn";
  }

  return "neutral";
}

function subnetCell(gateway: NatGatewayItem) {
  const subnet = valueOrDash(gateway.subnetId);
  const router = valueOrDash(gateway.routerId);

  if (subnet === "-" && router === "-") {
    return "-";
  }

  return (
    <div className="grid gap-1">
      <span>{subnet}</span>
      {router !== "-" ? (
        <span className="text-xs font-bold text-[#667085]">Router {router}</span>
      ) : null}
    </div>
  );
}

export default async function NatPage() {
  const result = await withCloudResult<NatGatewayItem[]>(
    [],
    listNatGateways,
    "listNatGateways",
  );
  const gateways = result.data;
  const active = gateways.filter((gateway) =>
    ["ACTIVE", "RUNNING"].includes(gateway.status.toUpperCase()),
  ).length;
  const enterpriseScoped = gateways.filter(
    (gateway) => valueOrDash(gateway.enterpriseProjectId) !== "-",
  ).length;

  return (
    <ReadonlyNetworkingPage
      actionLabel="Create NAT"
      actionTitle="NAT gateway creation is intentionally not implemented in this read-only view."
      description="Public NAT gateway inventory focused on routing attachment, status, and enterprise scope."
      error={result.error}
      icon={Router}
      isRefreshing={result.isRefreshing}
      title="NAT Gateway"
    >
      <StatusSummary
        items={[
          { label: "Gateways", value: gateways.length },
          { label: "Active", tone: "good", value: active },
          { label: "Enterprise scoped", value: enterpriseScoped },
          {
            label: "Needs attention",
            tone: gateways.length - active > 0 ? "warn" : "neutral",
            value: gateways.length - active,
          },
        ]}
      />

      <OperationalTable
        columns={[
          "Gateway",
          "Status",
          "Spec",
          "VPC",
          "Subnet / Router",
          "Enterprise Project",
          "Created",
          "Scope",
        ]}
        empty="No NAT gateways found."
        isCached={result.isCached}
        rows={gateways.map((gateway) => ({
          cells: [
            <ResourceLink key="name">{gateway.name}</ResourceLink>,
            <StatusBadge key="status" tone={natTone(gateway.status)}>
              {gateway.status}
            </StatusBadge>,
            [valueOrDash(gateway.spec), valueOrDash(gateway.type)]
              .filter((value) => value !== "-")
              .join(" / ") || "-",
            valueOrDash(gateway.vpcId),
            subnetCell(gateway),
            valueOrDash(gateway.enterpriseProjectId),
            gateway.createdAt ? <LocalDateTime key="created" value={gateway.createdAt} /> : "-",
            `${valueOrDash(gateway.projectName)} / ${valueOrDash(gateway.region)}`,
          ],
          id: gateway.id,
        }))}
        title="Public NAT gateways"
        updatedAt={result.updatedAt}
      />
    </ReadonlyNetworkingPage>
  );
}
