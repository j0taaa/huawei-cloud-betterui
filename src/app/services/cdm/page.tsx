import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { DatabaseZap } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listCdmClusters, type CdmCluster, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CDM | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  if (["200", "normal", "available"].includes(status.toLowerCase())) return "good";
  if (["300", "303", "failed", "error"].includes(status.toLowerCase())) return "bad";
  if (["100", "500", "910", "920", "creating", "starting", "stopping"].includes(status.toLowerCase())) return "warn";
  return "neutral";
}

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
        <div>
          <p className="font-black text-[#101828]">{cluster.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{cluster.id}</p>
        </div>
      ),
    },
    { header: "Status", render: (cluster) => <InventoryStatus tone={statusTone(cluster.status)}>{cluster.status}</InventoryStatus> },
    {
      header: "Runtime",
      render: (cluster) => (
        <div>
          <p>{cluster.mode}</p>
          <p className="mt-1 text-xs text-[#667085]">{cluster.version}</p>
        </div>
      ),
    },
    { header: "Flavor", render: (cluster) => cluster.flavor },
    { header: "Nodes", render: (cluster) => cluster.nodeCount },
    { header: "Manage IP", render: (cluster) => cluster.manageIp },
    { header: "Public endpoint", render: (cluster) => cluster.publicEndpoint },
  ];

  return (
    <ServiceInventoryPage
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
