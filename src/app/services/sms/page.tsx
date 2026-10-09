import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Server } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listSmsTasks, type SmsMigrationTask, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SMS | Huawei Cloud Better UI",
};

export default async function SmsPage() {
  const result = await withCloudResult<SmsMigrationTask[]>([], listSmsTasks, cloudCacheKeys.listSmsTasks);
  const tasks = result.data;
  const active = tasks.filter((task) => ["running", "syncing"].includes(task.state.toLowerCase())).length;
  const failed = tasks.filter((task) => task.state.toLowerCase().includes("fail")).length;
  const sources = new Set(tasks.map((task) => task.sourceServerId).filter((id) => id !== "-"));

  const columns: InventoryColumn<SmsMigrationTask>[] = [
    {
      header: "Migration task",
      render: (task) => (
        <ResourceIdentity
          className="text-[#101828]"
          id={task.id}
          idClassName="font-normal"
          name={task.name}
        />
      ),
    },
    { header: "State", render: (task) => <InventoryStatus tone={inventoryStatusTone(task.state)}>{task.state}</InventoryStatus> },
    {
      header: "Source",
      render: (task) => (
        <CellStack subValue={task.sourceServerId} subValueClassName="break-all">
          {task.sourceServer}
        </CellStack>
      ),
    },
    {
      header: "Target",
      render: (task) => (
        <CellStack subValue={task.targetServerId} subValueClassName="break-all">
          {task.targetServer}
        </CellStack>
      ),
    },
    { header: "Progress", render: (task) => task.progress },
    { header: "Sync speed", render: (task) => task.syncSpeed },
    { header: "Project / region", render: (task) => `${task.projectName} / ${task.region}` },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create task"
      actionTitle="SMS task creation is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to Services"
      columns={columns}
      description="Read-only server migration tasks with source-to-target mapping, progress, and replication state."
      empty="No SMS migration tasks found"
      icon={Server}
      result={result}
      rows={tasks}
      stats={[
        { label: "Tasks", value: tasks.length },
        { label: "Active syncs", value: active, tone: active ? "warn" : "neutral" },
        { label: "Failed", value: failed, tone: failed ? "bad" : "good" },
        { label: "Source servers", value: sources.size },
      ]}
      tableTitle="Server migration tasks"
      title="Server Migration Service"
      tone="blue"
    />
  );
}
