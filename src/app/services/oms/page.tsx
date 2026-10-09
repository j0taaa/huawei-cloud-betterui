import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Box } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listOmsMigrationTasks, type OmsMigrationTask, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "OMS | Huawei Cloud Better UI",
};

export default async function OmsPage() {
  const result = await withCloudResult<OmsMigrationTask[]>([], listOmsMigrationTasks, cloudCacheKeys.listOmsMigrationTasks);
  const tasks = result.data;
  const failedObjects = tasks.reduce((total, task) => total + task.failedObjects, 0);
  const clouds = new Set(tasks.map((task) => task.sourceCloud).filter((cloud) => cloud !== "-"));
  const active = tasks.filter((task) => ["1", "2", "3", "7"].includes(task.status)).length;

  const columns: InventoryColumn<OmsMigrationTask>[] = [
    {
      header: "Object task",
      render: (task) => (
        <ResourceIdentity
          className="text-[#101828]"
          id={task.id}
          idClassName="font-normal"
          name={task.name}
        />
      ),
    },
    { header: "Status", render: (task) => <InventoryStatus tone={inventoryStatusTone(task.status)}>{task.status}</InventoryStatus> },
    {
      header: "Path",
      render: (task) => (
        <CellStack subValue={task.sourceCloud}>{task.source} to {task.destination}</CellStack>
      ),
    },
    { header: "Type", render: (task) => task.taskType },
    { header: "Progress", render: (task) => task.progress },
    { header: "Size", render: (task) => `${task.completedSize} / ${task.totalSize}` },
    { header: "Failed objects", render: (task) => task.failedObjects },
  ];

  return (
    <ServiceInventoryPage
      managementService="oms"
      actionLabel="Create migration"
      actionTitle="OMS migration creation is disabled in this read-only view."
      active="Storage"
      backHref="/services/storage"
      backLabel="Back to Storage"
      columns={columns}
      description="Read-only object migration tasks with bucket direction, source cloud, transferred size, and failed object counts."
      empty="No OMS migration tasks found"
      icon={Box}
      result={result}
      rows={tasks}
      stats={[
        { label: "Tasks", value: tasks.length },
        { label: "Active", value: active, tone: active ? "warn" : "neutral" },
        { label: "Failed objects", value: failedObjects, tone: failedObjects ? "bad" : "good" },
        { label: "Source clouds", value: clouds.size },
      ]}
      tableTitle="Object migration tasks"
      title="Object Storage Migration Service"
      tone="green"
    />
  );
}
