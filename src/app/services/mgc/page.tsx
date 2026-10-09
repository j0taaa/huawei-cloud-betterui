import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Route } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listMgcMigrationItems, type MgcMigrationItem, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "MgC | Huawei Cloud Better UI",
};

export default async function MgcPage() {
  const result = await withCloudResult<MgcMigrationItem[]>([], listMgcMigrationItems, cloudCacheKeys.listMgcMigrationItems);
  const items = result.data;
  const active = items.filter((item) => ["running", "syncing", "migrating", "creating", "100"].includes(item.status.toLowerCase())).length;
  const failures = items.filter((item) => item.status.toLowerCase().includes("fail") || item.status === "300" || item.status === "303").length;
  const services = new Set(items.map((item) => item.service));

  const columns: InventoryColumn<MgcMigrationItem>[] = [
    {
      header: "Migration asset",
      render: (item) => (
        <ResourceIdentity id={item.id} name={item.name} />
      ),
    },
    { header: "Service", render: (item) => item.service },
    { header: "Status", render: (item) => <InventoryStatus tone={inventoryStatusTone(item.status)}>{item.status}</InventoryStatus> },
    {
      header: "Flow",
      render: (item) => (
        <CellStack subValue={item.signal}>{item.source} to {item.target}</CellStack>
      ),
    },
    { header: "Size / scope", render: (item) => item.sizeOrScope },
    { header: "Project / region", render: (item) => `${item.projectName} / ${item.region}` },
  ];

  return (
    <ServiceInventoryPage
      managementService="mgc"
      actionLabel="Create workflow"
      actionTitle="MgC workflow creation is disabled in this read-only view."
      active="Storage"
      backHref="/services/storage"
      backLabel="Back to Storage"
      columns={columns}
      description="Migration rollup over documented SMS, OMS, and CDM inventories. The management workspace exposes their implemented workflows; native MgC discovery and orchestration remain separate."
      empty="No migration-center activity found"
      icon={Route}
      result={result}
      rows={items}
      stats={[
        { label: "Assets", value: items.length },
        { label: "Active", value: active, tone: active ? "warn" : "neutral" },
        { label: "Failures", value: failures, tone: failures ? "bad" : "good" },
        { label: "Services", value: services.size },
      ]}
      tableTitle="Migration center rollup"
      title="Migration Center"
      tone="green"
    />
  );
}
