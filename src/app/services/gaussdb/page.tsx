import type { Metadata } from "next";
import { Database } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import {
  listGaussDbInstances,
  type GaussDbInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "GaussDB | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["normal", "available", "active", "running"].includes(normalized)) return "good";
  if (["faulty", "failed", "error", "abnormal"].includes(normalized)) return "bad";
  if (["creating", "backing-up", "rebooting", "scaling"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function GaussDbPage() {
  const result = await withCloudResult<GaussDbInstance[]>([], listGaussDbInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["normal", "available", "active", "running"].includes(instance.status.toLowerCase()),
  ).length;
  const nodes = instances.reduce((total, instance) => total + instance.nodes, 0);
  const modes = new Set(instances.map((instance) => instance.mode).filter((mode) => mode !== "-"));

  const columns: InventoryColumn<GaussDbInstance>[] = [
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
      header: "Datastore",
      render: (instance) => (
        <div>
          <p className="font-black">{instance.datastore}</p>
          <p className="mt-1 text-xs text-[#667085]">{instance.mode}</p>
        </div>
      ),
    },
    {
      header: "Topology",
      render: (instance) => `${instance.nodes || "-"} nodes / ${instance.availabilityZone}`,
    },
    { header: "Storage", render: (instance) => instance.storage },
    {
      header: "Access",
      render: (instance) => (
        <div>
          <p>{instance.privateIp}</p>
          <p className="mt-1 text-xs text-[#667085]">Port {instance.port}</p>
        </div>
      ),
    },
    { header: "Backup window", render: (instance) => instance.backupWindow },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create instance"
      actionTitle="GaussDB instance creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="GaussDB openGauss instance health, topology, private access, storage allocation, and backup window."
      empty="No GaussDB instances found"
      icon={Database}
      result={result}
      rows={instances}
      stats={[
        { label: "Instances", value: instances.length },
        { label: "Healthy", value: healthy, tone: healthy === instances.length ? "good" : "warn" },
        { label: "Nodes", value: nodes },
        { label: "Modes", value: modes.size },
      ]}
      tableTitle="GaussDB instances"
      title="GaussDB"
      tone="green"
    />
  );
}
