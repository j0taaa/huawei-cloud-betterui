import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ArchiveRestore } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { listSdrsProtectedInstances, type SdrsProtectedInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SDRS | Huawei Cloud Better UI",
};

export default async function SdrsPage() {
  const result = await withCloudResult<SdrsProtectedInstance[]>([], listSdrsProtectedInstances, cloudCacheKeys.listSdrsProtectedInstances);
  const instances = result.data;
  const protectedCount = instances.filter((item) => ["protected", "available"].includes(item.status.toLowerCase())).length;
  const groups = new Set(instances.map((item) => item.protectionGroupId).filter((id) => id !== "-"));
  const pairs = instances.reduce((total, item) => total + item.replicationPairs, 0);

  const columns: InventoryColumn<SdrsProtectedInstance>[] = [
    {
      header: "Protected instance",
      render: (item) => (
        <ResourceIdentity id={item.id} name={item.name} />
      ),
    },
    { header: "Status", render: (item) => <InventoryStatus tone={inventoryStatusTone(item.status)}>{item.status}</InventoryStatus> },
    { header: "Protection group", render: (item) => item.protectionGroupId },
    { header: "Production server", render: (item) => item.sourceServer },
    { header: "DR server", render: (item) => item.targetServer },
    { header: "Priority site", render: (item) => item.priorityStation },
    { header: "Pairs", render: (item) => item.replicationPairs },
  ];

  return (
    <ServiceInventoryPage
      managementService="sdrs"
      actionLabel="Create protection"
      actionTitle="SDRS protection creation is disabled in this read-only view."
      active="Storage"
      backHref="/services/storage"
      backLabel="Back to Storage"
      columns={columns}
      description="Read-only disaster recovery protection instances with production/DR server mapping and replication pair coverage."
      empty="No SDRS protected instances found"
      icon={ArchiveRestore}
      result={result}
      rows={instances}
      stats={[
        { label: "Protected instances", value: instances.length },
        { label: "Healthy", value: protectedCount, tone: protectedCount ? "good" : "neutral" },
        { label: "Protection groups", value: groups.size },
        { label: "Replication pairs", value: pairs },
      ]}
      tableTitle="Disaster recovery protection"
      title="Storage Disaster Recovery Service"
      tone="green"
    />
  );
}
