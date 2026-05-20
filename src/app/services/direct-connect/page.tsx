import type { Metadata } from "next";
import { Cable } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import {
  listDirectConnectConnections,
  type DirectConnectConnection,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "Direct Connect | Huawei Cloud Better UI" };

function statusTone(status: string) {
  const normalized = status.toUpperCase();

  if (["ACTIVE", "NORMAL"].includes(normalized)) {
    return "good";
  }

  if (["DOWN", "BUILD", "PENDING_CREATE", "PENDING_UPDATE"].includes(normalized)) {
    return "warn";
  }

  return normalized.includes("ERROR") ? "bad" : "neutral";
}

export default async function DirectConnectPage() {
  const result = await withCloudResult<DirectConnectConnection[]>(
    [],
    listDirectConnectConnections,
  );
  const connections = result.data;
  const active = connections.filter((connection) => statusTone(connection.status) === "good").length;
  const bandwidthTotal = connections.reduce((total, connection) => {
    const value = Number.parseInt(connection.bandwidth, 10);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

  return (
    <ServiceInventoryPage
      actionLabel="Request connection"
      actionTitle="Direct Connect ordering is intentionally disabled in this read-only view."
      active="Networking"
      backHref="/services/networking"
      backLabel="Back to Networking"
      columns={[
        {
          header: "Connection",
          render: (connection) => <span className="font-black">{connection.name}</span>,
        },
        {
          header: "Status",
          render: (connection) => (
            <InventoryStatus tone={statusTone(connection.status)}>
              {connection.status}
            </InventoryStatus>
          ),
        },
        { header: "Bandwidth", render: (connection) => connection.bandwidth },
        { header: "Port", render: (connection) => connection.portType },
        { header: "Provider", render: (connection) => connection.provider },
        { header: "Location", render: (connection) => connection.location },
        { header: "Peer", render: (connection) => connection.peerLocation },
        { header: "Scope", render: (connection) => `${connection.projectName} / ${connection.region}` },
      ]}
      description="Dedicated line inventory with circuit status, bandwidth, port, carrier, and location context."
      empty="No Direct Connect connections found."
      icon={Cable}
      result={result}
      rows={connections}
      stats={[
        { label: "Connections", value: connections.length },
        { label: "Active", value: active, tone: active === connections.length ? "good" : "warn" },
        { label: "Total bandwidth", value: bandwidthTotal ? `${bandwidthTotal} Mbit/s` : "-" },
        { label: "Providers", value: new Set(connections.map((item) => item.provider).filter((item) => item !== "-")).size },
      ]}
      tableTitle="Dedicated connections"
      title="Direct Connect"
    />
  );
}
