import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Database } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listDwsClusters, type DwsCluster, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DWS | Huawei Cloud Better UI",
};

export default async function DwsPage() {
  const result = await withCloudResult<DwsCluster[]>([], listDwsClusters, cloudCacheKeys.listDwsClusters);
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
        <ResourceIdentity
          className="text-[#101828]"
          id={cluster.id}
          idClassName="font-normal"
          name={cluster.name}
        />
      ),
    },
    { header: "State", render: (cluster) => <InventoryStatus tone={inventoryStatusTone(cluster.status)}>{cluster.status}</InventoryStatus> },
    {
      header: "Compute",
      render: (cluster) => (
        <CellStack className="font-black" subValue={cluster.nodeType}>
          {cluster.nodes || "-"} nodes
        </CellStack>
      ),
    },
    { header: "Version", render: (cluster) => cluster.version },
    {
      header: "Endpoint",
      render: (cluster) => (
        <CellStack subValue={`Port ${cluster.port}`}>
          {cluster.endpoint}
        </CellStack>
      ),
    },
    { header: "AZ", render: (cluster) => cluster.availabilityZone },
    { header: "Project / region", render: (cluster) => `${cluster.projectName} / ${cluster.region}` },
  ];

  return (
    <ServiceInventoryPage
      managementService="dws"
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
