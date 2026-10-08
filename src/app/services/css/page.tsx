import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Search } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listCssClusters, type CssCluster, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CSS | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["available", "running", "200"].includes(normalized)) return "good";
  if (["failed", "error", "faulty"].includes(normalized)) return "bad";
  if (["creating", "scaling", "rebooting", "upgrading"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function CssPage() {
  const result = await withCloudResult<CssCluster[]>([], listCssClusters, cloudCacheKeys.listCssClusters);
  const clusters = result.data;
  const available = clusters.filter((cluster) =>
    ["available", "running", "200"].includes(cluster.status.toLowerCase()),
  ).length;
  const nodes = clusters.reduce((total, cluster) => total + cluster.nodeCount, 0);
  const datastores = new Set(clusters.map((cluster) => cluster.datastore).filter((datastore) => datastore !== "-"));

  const columns: InventoryColumn<CssCluster>[] = [
    {
      header: "Search cluster",
      render: (cluster) => (
        <div>
          <p className="font-black text-[#101828]">{cluster.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{cluster.id}</p>
        </div>
      ),
    },
    { header: "State", render: (cluster) => <InventoryStatus tone={statusTone(cluster.status)}>{cluster.status}</InventoryStatus> },
    { header: "Engine", render: (cluster) => cluster.datastore },
    {
      header: "Nodes",
      render: (cluster) => (
        <div>
          <p className="font-black">{cluster.nodeCount || "-"} nodes</p>
          <p className="mt-1 text-xs text-[#667085]">{cluster.nodeSpec}</p>
        </div>
      ),
    },
    { header: "Storage", render: (cluster) => cluster.storage },
    { header: "Endpoint", render: (cluster) => cluster.endpoint },
    { header: "Project / region", render: (cluster) => `${cluster.projectName} / ${cluster.region}` },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create cluster"
      actionTitle="CSS cluster creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="Elasticsearch/OpenSearch clusters with engine version, node shape, storage, access endpoint, and operational state."
      empty="No CSS clusters found"
      icon={Search}
      result={result}
      rows={clusters}
      stats={[
        { label: "Clusters", value: clusters.length },
        { label: "Available", value: available, tone: available === clusters.length ? "good" : "warn" },
        { label: "Nodes", value: nodes },
        { label: "Engines", value: datastores.size },
      ]}
      tableTitle="Search clusters"
      title="Cloud Search Service"
      tone="blue"
    />
  );
}
