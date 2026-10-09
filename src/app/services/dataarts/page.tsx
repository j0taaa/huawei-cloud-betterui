import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { FolderTree } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listDataArtsInstances, type DataArtsInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DataArts | Huawei Cloud Better UI",
};

export default async function DataArtsPage() {
  const result = await withCloudResult<DataArtsInstance[]>([], listDataArtsInstances, cloudCacheKeys.listDataArtsInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) => ["running", "normal", "available", "active"].includes(instance.status.toLowerCase())).length;
  const workspaces = instances.reduce((total, instance) => total + instance.workspaceCount, 0);
  const editions = new Set(instances.map((instance) => instance.edition).filter((edition) => edition !== "-"));

  const columns: InventoryColumn<DataArtsInstance>[] = [
    {
      header: "Instance",
      render: (instance) => (
        <ResourceIdentity
          className="text-[#101828]"
          id={instance.id}
          idClassName="font-normal"
          name={instance.name}
        />
      ),
    },
    { header: "Status", render: (instance) => <InventoryStatus tone={inventoryStatusTone(instance.status)}>{instance.status}</InventoryStatus> },
    {
      header: "Edition",
      render: (instance) => (
        <CellStack subValue={instance.version}>
          {instance.edition}
        </CellStack>
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
