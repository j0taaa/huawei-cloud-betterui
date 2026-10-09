import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { DatabaseZap } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack } from "@/components/console-ui";
import { listDliQueues, type DliQueue, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DLI | Huawei Cloud Better UI",
};

export default async function DliPage() {
  const result = await withCloudResult<DliQueue[]>([], listDliQueues, cloudCacheKeys.listDliQueues);
  const queues = result.data;
  const available = queues.filter((queue) =>
    ["available", "running", "normal"].includes(queue.status.toLowerCase()),
  ).length;
  const totalCus = queues.reduce((total, queue) => total + queue.cuCount, 0);
  const queueTypes = new Set(queues.map((queue) => queue.type).filter((type) => type !== "-"));

  const columns: InventoryColumn<DliQueue>[] = [
    { header: "Queue", render: (queue) => <span className="font-black text-[#101828]">{queue.name}</span> },
    { header: "State", render: (queue) => <InventoryStatus tone={inventoryStatusTone(queue.status)}>{queue.status}</InventoryStatus> },
    {
      header: "Workload",
      render: (queue) => (
        <CellStack subValue={queue.engine}>{queue.type}</CellStack>
      ),
    },
    { header: "CUs", render: (queue) => queue.cuCount || "-" },
    { header: "Billing", render: (queue) => queue.chargingMode },
    { header: "Owner", render: (queue) => queue.owner },
    { header: "Project / region", render: (queue) => `${queue.projectName} / ${queue.region}` },
  ];

  return (
    <ServiceInventoryPage
      managementService="dli"
      actionLabel="Create queue"
      actionTitle="DLI queue creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="SQL, Spark, and Flink queue inventory with capacity units, billing mode, owner, and queue health."
      empty="No DLI queues found"
      icon={DatabaseZap}
      result={result}
      rows={queues}
      stats={[
        { label: "Queues", value: queues.length },
        { label: "Available", value: available, tone: available === queues.length ? "good" : "warn" },
        { label: "Total CUs", value: totalCus },
        { label: "Queue types", value: queueTypes.size },
      ]}
      tableTitle="DLI queues"
      title="Data Lake Insight"
      tone="green"
    />
  );
}
