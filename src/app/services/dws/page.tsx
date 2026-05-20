import type { Metadata } from "next";
import { Database } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listDwsClusters, type DwsCluster, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DWS | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["available", "active", "running"].includes(normalized)) return "good";
  if (["failed", "creation failed", "deletion failed"].includes(normalized)) return "bad";
  if (["creating", "starting", "stoping", "stopped", "scaling"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function DwsPage() {
  const result = await withCloudResult<DwsCluster[]>([], listDwsClusters);
  const clusters = result.data;
  const available = clusters.filter((cluster) =>
    ["available", "active", "running"].includes(cluster.status.toLowerCase()),
  ).length;
  const nodes = clusters.reduce((total, cluster) => total + cluster.nodes, 0);
  const nodeTypes = new Set(clusters.map((cluster) => cluster.nodeType).filter((type) => type !== "-"));

  const columns: InventoryColumn<DwsCluster>[] = [
    {
      header: "Warehouse",
      render: (cluster) => (
        <div>
          <p className="font-black text-[#101828]">{cluster.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{cluster.id}</p>
        </div>
      ),
    },
    { header: "State", render: (cluster) => <InventoryStatus tone={statusTone(cluster.status)}>{cluster.status}</InventoryStatus> },
    {
      header: "Compute",
      render: (cluster) => (
        <div>
          <p className="font-black">{cluster.nodes || "-"} nodes</p>
          <p className="mt-1 text-xs text-[#667085]">{cluster.nodeType}</p>
        </div>
      ),
    },
    { header: "Version", render: (cluster) => cluster.version },
    {
      header: "Endpoint",
      render: (cluster) => (
        <div>
          <p>{cluster.endpoint}</p>
          <p className="mt-1 text-xs text-[#667085]">Port {cluster.port}</p>
        </div>
      ),
    },
    { header: "AZ", render: (cluster) => cluster.availabilityZone },
    { header: "Project / region", render: (cluster) => `${cluster.projectName} / ${cluster.region}` },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create cluster"
      actionTitle="DWS cluster creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="GaussDB(DWS) warehouse clusters with node type, endpoint, port, version, and availability-zone placement."
      empty="No DWS clusters found"
      icon={Database}
      result={result}
      rows={clusters}
      stats={[
        { label: "Warehouses", value: clusters.length },
        { label: "Available", value: available, tone: available === clusters.length ? "good" : "warn" },
        { label: "Nodes", value: nodes },
        { label: "Node types", value: nodeTypes.size },
      ]}
      tableTitle="DWS clusters"
      title="Data Warehouse Service"
      tone="green"
    />
  );
}
