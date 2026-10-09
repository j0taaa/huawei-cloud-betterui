import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { BrainCircuit } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import {
  listModelArtsNotebooks,
  type ModelArtsNotebook,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ModelArts | Huawei Cloud Better UI",
};

export default async function ModelArtsPage() {
  const result = await withCloudResult<ModelArtsNotebook[]>([], listModelArtsNotebooks, cloudCacheKeys.listModelArtsNotebooks);
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
        <ResourceIdentity id={notebook.id} name={notebook.name} />
      ),
    },
    {
      header: "Runtime state",
      render: (notebook) => <InventoryStatus tone={inventoryStatusTone(notebook.status)}>{notebook.status}</InventoryStatus>,
    },
    {
      header: "Compute",
      render: (notebook) => (
        <CellStack subValue={`Pool ${notebook.pool}`}>{notebook.flavor}</CellStack>
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
