import type { Metadata } from "next";
import { Route } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listMgcMigrationItems, type MgcMigrationItem, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "MgC | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (["success", "succeeded", "migrate_success", "normal", "200"].includes(normalized)) return "good";
  if (["failed", "error", "migrate_fail", "300", "303"].includes(normalized)) return "bad";
  if (["running", "syncing", "migrating", "creating", "100"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function MgcPage() {
  const result = await withCloudResult<MgcMigrationItem[]>([], listMgcMigrationItems);
  const items = result.data;
  const active = items.filter((item) => ["running", "syncing", "migrating", "creating", "100"].includes(item.status.toLowerCase())).length;
  const failures = items.filter((item) => item.status.toLowerCase().includes("fail") || item.status === "300" || item.status === "303").length;
  const services = new Set(items.map((item) => item.service));

  const columns: InventoryColumn<MgcMigrationItem>[] = [
    {
      header: "Migration asset",
      render: (item) => (
        <div>
          <p className="font-black text-[#101828]">{item.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{item.id}</p>
        </div>
      ),
    },
    { header: "Service", render: (item) => item.service },
    { header: "Status", render: (item) => <InventoryStatus tone={statusTone(item.status)}>{item.status}</InventoryStatus> },
    {
      header: "Flow",
      render: (item) => (
        <div>
          <p className="font-black">{item.source} to {item.target}</p>
          <p className="mt-1 text-xs text-[#667085]">{item.signal}</p>
        </div>
      ),
    },
    { header: "Size / scope", render: (item) => item.sizeOrScope },
    { header: "Project / region", render: (item) => `${item.projectName} / ${item.region}` },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create workflow"
      actionTitle="MgC workflow creation is disabled in this read-only view."
      active="Storage"
      backHref="/services/storage"
      backLabel="Back to Storage"
      columns={columns}
      description="Read-only migration center rollup over documented SMS, OMS, and CDM inventories for server, object, and data migration activity."
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
