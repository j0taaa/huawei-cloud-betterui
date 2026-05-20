import type { Metadata } from "next";
import { FileJson } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listDdsInstances, type DdsInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DDS | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["normal", "available", "active", "running"].includes(normalized)) return "good";
  if (["faulty", "failed", "error", "abnormal"].includes(normalized)) return "bad";
  if (["creating", "backing-up", "rebooting", "scaling"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function DdsPage() {
  const result = await withCloudResult<DdsInstance[]>([], listDdsInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["normal", "available", "active", "running"].includes(instance.status.toLowerCase()),
  ).length;
  const nodes = instances.reduce((total, instance) => total + instance.nodes, 0);
  const vpcs = new Set(instances.map((instance) => instance.vpcId).filter((vpc) => vpc !== "-"));

  const columns: InventoryColumn<DdsInstance>[] = [
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
    { header: "Mongo engine", render: (instance) => instance.datastore },
    {
      header: "Topology",
      render: (instance) => (
        <div>
          <p>{instance.mode}</p>
          <p className="mt-1 text-xs text-[#667085]">{instance.nodes || "-"} nodes / {instance.availabilityZone}</p>
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
      actionTitle="DDS instance creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="MongoDB-compatible DDS instances with cluster layout, storage allocation, private endpoint, and backup window."
      empty="No DDS instances found"
      icon={FileJson}
      result={result}
      rows={instances}
      stats={[
        { label: "Instances", value: instances.length },
        { label: "Healthy", value: healthy, tone: healthy === instances.length ? "good" : "warn" },
        { label: "Nodes", value: nodes },
        { label: "VPCs", value: vpcs.size },
      ]}
      tableTitle="Document database instances"
      title="Document Database Service"
      tone="blue"
    />
  );
}
