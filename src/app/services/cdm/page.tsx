import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { DatabaseZap } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listCdmClusters, type CdmCluster, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CDM | Huawei Cloud Better UI",
};

export default async function CdmPage() {
  const result = await withCloudResult<CdmCluster[]>([], listCdmClusters, cloudCacheKeys.listCdmClusters);
  const clusters = result.data;
  const normal = clusters.filter((cluster) => ["200", "normal"].includes(cluster.status.toLowerCase())).length;
  const nodes = clusters.reduce((total, cluster) => total + cluster.nodeCount, 0);
  const publicEndpoints = clusters.filter((cluster) => cluster.publicEndpoint !== "-").length;

  const columns: InventoryColumn<CdmCluster>[] = [
    {
      header: "Cluster",
      render: (cluster) => (
        <ResourceIdentity
          className="text-[#101828]"
          id={cluster.id}
          idClassName="font-normal"
          name={cluster.name}
        />
      ),
    },
    { header: "Status", render: (cluster) => <InventoryStatus tone={inventoryStatusTone(cluster.status)}>{cluster.status}</InventoryStatus> },
    {
      header: "Runtime",
      render: (cluster) => (
        <CellStack subValue={cluster.version}>
          {cluster.mode}
        </CellStack>
      ),
    },
    { header: "Flavor", render: (cluster) => cluster.flavor },
    { header: "Nodes", render: (cluster) => cluster.nodeCount },
    { header: "Manage IP", render: (cluster) => cluster.manageIp },
    { header: "Public endpoint", render: (cluster) => cluster.publicEndpoint },
  ];

  return (
    <ServiceInventoryPage
      managementService="cdm"
      actionLabel="Create cluster"
      actionTitle="CDM cluster creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="Read-only Cloud Data Migration clusters with status, runtime mode, node count, and management access points."
      empty="No CDM clusters found"
      icon={DatabaseZap}
      result={result}
      rows={clusters}
      stats={[
        { label: "Clusters", value: clusters.length },
        { label: "Normal", value: normal, tone: normal ? "good" : "neutral" },
        { label: "Nodes", value: nodes },
        { label: "Public endpoints", value: publicEndpoints },
      ]}
      tableTitle="Data migration clusters"
      title="Cloud Data Migration"
      tone="blue"
    />
  );
}
