import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import {
  joinValues,
  OperationalTable,
  ReadonlyNetworkingPage,
  ResourceLink,
  StatusBadge,
  StatusSummary,
  valueOrDash,
} from "@/app/services/_components/networking-readonly";
import { CellStack } from "@/components/console-ui";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = {
  title: "VPN | Huawei Cloud Better UI",
};

type VpnConnectionItem = {
  cgwId?: string;
  connectionMonitorId?: string;
  createdAt?: string;
  enterpriseProjectId?: string;
  haRole?: string;
  id: string;
  localSubnets?: string | string[];
  name: string;
  peerSubnets?: string | string[];
  projectId?: string;
  projectName?: string;
  region?: string;
  status: string;
  style?: string;
  tunnelLocalAddress?: string;
  tunnelPeerAddress?: string;
  updatedAt?: string;
  vgwId?: string;
  vgwIp?: string;
};

type CloudModule = Omit<typeof huaweiCloud, "listVpnConnections"> & {
  listVpnConnections?: (session: BetterUiSession) => Promise<VpnConnectionItem[]>;
};

const cloud = huaweiCloud as unknown as CloudModule;

async function listVpnConnections(session: BetterUiSession) {
  if (typeof cloud.listVpnConnections !== "function") {
    throw new Error("Expected @/lib/huawei-cloud to export listVpnConnections(session).");
  }

  return cloud.listVpnConnections(session);
}

function vpnTone(status: string) {
  const normalized = status.toUpperCase();

  if (normalized === "ACTIVE") {
    return "good";
  }

  if (["ERROR", "DOWN", "FREEZED"].includes(normalized)) {
    return normalized === "DOWN" ? "warn" : "bad";
  }

  if (normalized.startsWith("PENDING")) {
    return "warn";
  }

  return "neutral";
}

function gatewayCell(connection: VpnConnectionItem) {
  return (
    <CellStack subValue={valueOrDash(connection.vgwIp)}>
      {valueOrDash(connection.vgwId)}
    </CellStack>
  );
}

function tunnelCell(connection: VpnConnectionItem) {
  const local = valueOrDash(connection.tunnelLocalAddress);
  const peer = valueOrDash(connection.tunnelPeerAddress);

  if (local === "-" && peer === "-") {
    return "-";
  }

  return (
    <CellStack subValue={`Peer ${peer}`}>
      Local {local}
    </CellStack>
  );
}

function subnetList(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return joinValues(value);
  }

  return valueOrDash(value);
}

export default async function VpnPage() {
  const result = await withCloudResult<VpnConnectionItem[]>(
    [],
    listVpnConnections,
    cloudCacheKeys.listVpnConnections,
  );
  const connections = result.data;
  const active = connections.filter(
    (connection) => connection.status.toUpperCase() === "ACTIVE",
  ).length;
  const monitored = connections.filter(
    (connection) => valueOrDash(connection.connectionMonitorId) !== "-",
  ).length;

  return (
    <ReadonlyNetworkingPage
      actionLabel="Create VPN"
      actionTitle="VPN connection creation is intentionally not implemented in this read-only view."
      description="Site-to-site VPN connection inventory with gateway, tunnel, and route context."
      error={result.error}
      icon={ShieldCheck}
      isRefreshing={result.isRefreshing}
      title="Virtual Private Network"
    >
      <StatusSummary
        items={[
          { label: "Connections", value: connections.length },
          { label: "Active", tone: "good", value: active },
          {
            label: "Non-active",
            tone: connections.length - active > 0 ? "warn" : "neutral",
            value: connections.length - active,
          },
          { label: "Monitored", value: monitored },
        ]}
      />

      <OperationalTable
        columns={[
          "Connection",
          "Status",
          "Mode",
          "VPN Gateway",
          "Customer Gateway",
          "Peer Subnets",
          "Tunnel",
          "Updated",
          "Scope",
        ]}
        empty="No VPN connections found."
        isCached={result.isCached}
        rows={connections.map((connection) => ({
          cells: [
            <ResourceLink key="name">{connection.name}</ResourceLink>,
            <StatusBadge key="status" tone={vpnTone(connection.status)}>
              {connection.status}
            </StatusBadge>,
            [valueOrDash(connection.style), valueOrDash(connection.haRole)]
              .filter((value) => value !== "-")
              .join(" / ") || "-",
            gatewayCell(connection),
            valueOrDash(connection.cgwId),
            subnetList(connection.peerSubnets ?? connection.localSubnets),
            tunnelCell(connection),
            connection.updatedAt || connection.createdAt ? (
              <LocalDateTime
                key="updated"
                value={connection.updatedAt ?? connection.createdAt ?? ""}
              />
            ) : (
              "-"
            ),
            `${valueOrDash(connection.projectName)} / ${valueOrDash(connection.region)}`,
          ],
          id: connection.id,
        }))}
        title="VPN connections"
        updatedAt={result.updatedAt}
      />
    </ReadonlyNetworkingPage>
  );
}
