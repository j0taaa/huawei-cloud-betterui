import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Layers3 } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listMrsClusters, type MrsCluster, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "MRS | Huawei Cloud Better UI",
};

export default async function MrsPage() {
  const result = await withCloudResult<MrsCluster[]>([], listMrsClusters, cloudCacheKeys.listMrsClusters);
  const clusters = result.data;
  const running = clusters.filter((cluster) => cluster.status.toLowerCase() === "running").length;
  const nodes = clusters.reduce((total, cluster) => total + cluster.totalNodes, 0);
  const componentNames = new Set(
    clusters.flatMap((cluster) => cluster.components.split(", ").filter((component) => component && component !== "-")),
  );

  const columns: InventoryColumn<MrsCluster>[] = [
    {
      header: "Cluster",
      render: (cluster) => (
        <ResourceIdentity id={cluster.id} name={cluster.name} />
      ),
    },
    { header: "State", render: (cluster) => <InventoryStatus tone={inventoryStatusTone(cluster.status)}>{cluster.status}</InventoryStatus> },
    {
      header: "Nodes",
      render: (cluster) => (
        <CellStack subValue={`${cluster.masterNodes} master / ${cluster.coreNodes} core`}>
          {cluster.totalNodes || "-"} total
        </CellStack>
      ),
    },
    { header: "Components", render: (cluster) => cluster.components },
    { header: "Hadoop", render: (cluster) => cluster.hadoopVersion },
    { header: "VPC", render: (cluster) => cluster.vpcId },
    { header: "Billing", render: (cluster) => cluster.billingType },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create cluster"
      managementService="mrs"
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="Big data clusters with node topology, Hadoop version, deployed components, network placement, and billing mode."
      empty="No MRS clusters found"
      icon={Layers3}
      result={result}
      rows={clusters}
      stats={[
        { label: "Clusters", value: clusters.length },
        { label: "Running", value: running, tone: running === clusters.length ? "good" : "warn" },
        { label: "Nodes", value: nodes },
        { label: "Components", value: componentNames.size },
      ]}
      tableTitle="MRS clusters"
      title="MapReduce Service"
      tone="blue"
    />
  );
}
