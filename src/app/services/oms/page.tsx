import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Box } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listOmsMigrationTasks, type OmsMigrationTask, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "OMS | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  if (["5", "success", "succeeded", "finished"].includes(status.toLowerCase())) return "good";
  if (["4", "failed", "error"].includes(status.toLowerCase())) return "bad";
  if (["1", "2", "3", "7", "migrating", "paused", "waiting"].includes(status.toLowerCase())) return "warn";
  return "neutral";
}

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
        <div>
          <p className="font-black text-[#101828]">{task.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{task.id}</p>
        </div>
      ),
    },
    { header: "Status", render: (task) => <InventoryStatus tone={statusTone(task.status)}>{task.status}</InventoryStatus> },
    {
      header: "Path",
      render: (task) => (
        <div>
          <p className="font-black">{task.source} to {task.destination}</p>
          <p className="mt-1 text-xs text-[#667085]">{task.sourceCloud}</p>
        </div>
      ),
    },
    { header: "Type", render: (task) => task.taskType },
    { header: "Progress", render: (task) => task.progress },
    { header: "Size", render: (task) => `${task.completedSize} / ${task.totalSize}` },
    { header: "Failed objects", render: (task) => task.failedObjects },
  ];

  return (
    <ServiceInventoryPage
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
