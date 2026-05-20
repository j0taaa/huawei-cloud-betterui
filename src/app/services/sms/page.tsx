import type { Metadata } from "next";
import { Server } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { listSmsTasks, type SmsMigrationTask, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SMS | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (["migrate_success", "success", "finished"].includes(normalized)) return "good";
  if (["migrate_fail", "failed", "error", "abort"].includes(normalized)) return "bad";
  if (["running", "syncing", "ready", "aborting"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function SmsPage() {
  const result = await withCloudResult<SmsMigrationTask[]>([], listSmsTasks);
  const tasks = result.data;
  const active = tasks.filter((task) => ["running", "syncing"].includes(task.state.toLowerCase())).length;
  const failed = tasks.filter((task) => task.state.toLowerCase().includes("fail")).length;
  const sources = new Set(tasks.map((task) => task.sourceServerId).filter((id) => id !== "-"));

  const columns: InventoryColumn<SmsMigrationTask>[] = [
    {
      header: "Migration task",
      render: (task) => (
        <div>
          <p className="font-black text-[#101828]">{task.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{task.id}</p>
        </div>
      ),
    },
    { header: "State", render: (task) => <InventoryStatus tone={statusTone(task.state)}>{task.state}</InventoryStatus> },
    {
      header: "Source",
      render: (task) => (
        <div>
          <p>{task.sourceServer}</p>
          <p className="mt-1 break-all text-xs text-[#667085]">{task.sourceServerId}</p>
        </div>
      ),
    },
    {
      header: "Target",
      render: (task) => (
        <div>
          <p>{task.targetServer}</p>
          <p className="mt-1 break-all text-xs text-[#667085]">{task.targetServerId}</p>
        </div>
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
