import type { Metadata } from "next";
import { BrainCircuit } from "lucide-react";

import {
  InventoryStatus,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import {
  listModelArtsNotebooks,
  type ModelArtsNotebook,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ModelArts | Huawei Cloud Better UI",
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["running", "active", "inservice"].includes(normalized)) return "good";
  if (["error", "failed", "create_failed", "start_failed"].includes(normalized)) return "bad";
  if (["creating", "starting", "stopping", "snapshooting", "snapshotting"].includes(normalized)) return "warn";
  return "neutral";
}

export default async function ModelArtsPage() {
  const result = await withCloudResult<ModelArtsNotebook[]>([], listModelArtsNotebooks);
  const notebooks = result.data;
  const running = notebooks.filter((notebook) =>
    ["running", "active", "inservice"].includes(notebook.status.toLowerCase()),
  ).length;
  const workspaces = new Set(notebooks.map((notebook) => notebook.workspaceId).filter((id) => id !== "-"));
  const pools = new Set(notebooks.map((notebook) => notebook.pool).filter((pool) => pool !== "-"));

  const columns: InventoryColumn<ModelArtsNotebook>[] = [
    {
      header: "Notebook",
      render: (notebook) => (
        <div>
          <p className="font-black text-[#101828]">{notebook.name}</p>
          <p className="mt-1 break-all text-xs text-[#98a2b3]">{notebook.id}</p>
        </div>
      ),
    },
    {
      header: "Runtime state",
      render: (notebook) => <InventoryStatus tone={statusTone(notebook.status)}>{notebook.status}</InventoryStatus>,
    },
    {
      header: "Compute",
      render: (notebook) => (
        <div>
          <p className="font-black">{notebook.flavor}</p>
          <p className="mt-1 text-xs text-[#667085]">Pool {notebook.pool}</p>
        </div>
      ),
    },
    { header: "Image", render: (notebook) => notebook.image },
    { header: "Storage", render: (notebook) => notebook.storage },
    { header: "Workspace", render: (notebook) => notebook.workspaceId },
    { header: "Project / region", render: (notebook) => `${notebook.projectName} / ${notebook.region}` },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create notebook"
      actionTitle="ModelArts notebook creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="Notebook development environments with runtime state, compute flavor, image, workspace, and resource pool placement."
      empty="No ModelArts notebook instances found"
      icon={BrainCircuit}
      result={result}
      rows={notebooks}
      stats={[
        { label: "Notebooks", value: notebooks.length },
        { label: "Running", value: running, tone: running ? "good" : "neutral" },
        { label: "Workspaces", value: workspaces.size },
        { label: "Pools", value: pools.size },
      ]}
      tableTitle="Development notebooks"
      title="ModelArts"
      tone="blue"
    />
  );
}
