import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Workflow } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import {
  listCodeArtsPipelines,
  type CodeArtsPipelineItem,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CodeArts Pipeline | Huawei Cloud Better UI",
};

const columns: InventoryColumn<CodeArtsPipelineItem>[] = [
  {
    header: "Pipeline",
    render: (pipeline) => (
      <ResourceIdentity id={pipeline.id} name={pipeline.name} />
    ),
  },
  { header: "Status", render: (pipeline) => <InventoryStatus tone={inventoryStatusTone(pipeline.status)}>{pipeline.status}</InventoryStatus> },
  { header: "Group", render: (pipeline) => pipeline.groupName },
  { header: "Source", render: (pipeline) => pipeline.source },
  { header: "Creator", render: (pipeline) => pipeline.creator },
  { header: "Executor", render: (pipeline) => pipeline.executor },
  { header: "Latest run", render: (pipeline) => pipeline.latestRunAt },
];

export default async function CodeArtsPipelinePage() {
  const result = await withCloudResult<CodeArtsPipelineItem[]>([], listCodeArtsPipelines, cloudCacheKeys.listCodeArtsPipelines);
  const pipelines = result.data;
  const unhealthy = pipelines.filter((pipeline) => inventoryStatusTone(pipeline.status) === "bad").length;

  return (
    <ServiceInventoryPage
      managementService="codearts-pipeline"
      actionLabel="Create pipeline"
      actionTitle="Pipeline creation is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Pipeline execution status, grouping, source, creator, executor, and latest run time."
      empty="No CodeArts pipelines were returned for the selected projects."
      icon={Workflow}
      result={result}
      rows={pipelines}
      stats={[
        { label: "Pipelines", value: pipelines.length },
        { label: "Needs attention", value: unhealthy, tone: unhealthy ? "bad" : "good" },
        { label: "Groups", value: new Set(pipelines.map((pipeline) => pipeline.groupName).filter((group) => group !== "-")).size },
        { label: "Projects", value: new Set(pipelines.map((pipeline) => pipeline.projectId)).size },
      ]}
      tableTitle="Pipeline inventory"
      title="CodeArts Pipeline"
    />
  );
}
