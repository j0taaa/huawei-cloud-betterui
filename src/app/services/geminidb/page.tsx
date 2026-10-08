import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Braces } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import {
  listGeminiDbInstances,
  type GeminiDbInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "GeminiDB | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["normal", "available", "active", "running"].includes(normalized)) return "good";
  if (["faulty", "failed", "error", "abnormal"].includes(normalized)) return "bad";
  if (["creating", "backing-up", "rebooting", "scaling"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function GeminiDbPage() {
  const result = await withCloudResult<GeminiDbInstance[]>([], listGeminiDbInstances, cloudCacheKeys.listGeminiDbInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["normal", "available", "active", "running"].includes(instance.status.toLowerCase()),
  ).length;
  const nodes = instances.reduce((total, instance) => total + instance.nodeCount, 0);
  const apiTypes = new Set(instances.map((instance) => instance.apiType).filter((type) => type !== "-"));

  const columns: InventoryColumn<GeminiDbInstance>[] = [
    {
      header: "Instance",
      render: (instance) => (
        <div>
          <p className="font-black text-[#101828]">{instance.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{instance.id}</p>
        </div>
      ),
    },
    {
      header: "State",
      render: (instance) => <InventoryStatus tone={statusTone(instance.status)}>{instance.status}</InventoryStatus>,
    },
    {
      header: "API",
      render: (instance) => (
        <div>
          <p className="font-black">{instance.apiType}</p>
          <p className="mt-1 text-xs text-[#667085]">{instance.datastore}</p>
        </div>
      ),
    },
    {
      header: "Topology",
      render: (instance) => (
        <div>
          <p>{instance.groupCount || "-"} groups</p>
          <p className="mt-1 text-xs text-[#667085]">{instance.nodeCount || "-"} nodes / {instance.mode}</p>
        </div>
      ),
    },
    { header: "Storage", render: (instance) => instance.storage },
    {
      header: "Network",
      render: (instance) => (
        <div>
          <p>{instance.privateIp}</p>
          <p className="mt-1 break-all text-xs text-[#667085]">VPC {instance.vpcId}</p>
        </div>
      ),
    },
    { header: "Backup window", render: (instance) => instance.backupWindow },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create instance"
      actionTitle="GeminiDB instance creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="GeminiDB Cassandra, Mongo, Influx, and Redis-compatible instances with API type, groups, nodes, storage, and network placement."
      empty="No GeminiDB instances found"
      icon={Braces}
      result={result}
      rows={instances}
      stats={[
        { label: "Instances", value: instances.length },
        { label: "Healthy", value: healthy, tone: healthy === instances.length ? "good" : "warn" },
        { label: "Nodes", value: nodes },
        { label: "API types", value: apiTypes.size },
      ]}
      tableTitle="Multi-model database instances"
      title="GeminiDB"
      tone="blue"
    />
  );
}
