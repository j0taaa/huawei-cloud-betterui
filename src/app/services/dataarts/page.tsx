import type { Metadata } from "next";
import { FolderTree } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listDataArtsInstances, type DataArtsInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DataArts | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (["running", "normal", "available", "active"].includes(normalized)) return "good";
  if (["failed", "error", "abnormal"].includes(normalized)) return "bad";
  if (["creating", "upgrading", "starting"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function DataArtsPage() {
  const result = await withCloudResult<DataArtsInstance[]>([], listDataArtsInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) => ["running", "normal", "available", "active"].includes(instance.status.toLowerCase())).length;
  const workspaces = instances.reduce((total, instance) => total + instance.workspaceCount, 0);
  const editions = new Set(instances.map((instance) => instance.edition).filter((edition) => edition !== "-"));

  const columns: InventoryColumn<DataArtsInstance>[] = [
    {
      header: "Instance",
      render: (instance) => (
        <div>
          <p className="font-black text-[#101828]">{instance.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{instance.id}</p>
        </div>
      ),
    },
    { header: "Status", render: (instance) => <InventoryStatus tone={statusTone(instance.status)}>{instance.status}</InventoryStatus> },
    {
      header: "Edition",
      render: (instance) => (
        <div>
          <p>{instance.edition}</p>
          <p className="mt-1 text-xs text-[#667085]">{instance.version}</p>
        </div>
      ),
    },
    { header: "Workspaces", render: (instance) => instance.workspaceCount },
    { header: "Charging", render: (instance) => instance.chargingMode },
    { header: "Description", render: (instance) => instance.description || "-" },
    { header: "Project / region", render: (instance) => `${instance.projectName} / ${instance.region}` },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create instance"
      actionTitle="DataArts instance creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="Read-only DataArts Studio instances with edition, workspace capacity, lifecycle status, and regional placement."
      empty="No DataArts Studio instances found"
      icon={FolderTree}
      result={result}
      rows={instances}
      stats={[
        { label: "Instances", value: instances.length },
        { label: "Healthy", value: healthy, tone: healthy ? "good" : "neutral" },
        { label: "Workspaces", value: workspaces },
        { label: "Editions", value: editions.size },
      ]}
      tableTitle="Data governance instances"
      title="DataArts Studio"
      tone="blue"
    />
  );
}
