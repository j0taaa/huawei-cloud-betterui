import type { Metadata } from "next";
import { Hammer } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import {
  listCodeArtsBuildJobs,
  type CodeArtsBuildJob,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CodeArts Build | Huawei Cloud Better UI",
};

function statusTone(status: string): "bad" | "good" | "neutral" | "warn" {
  const normalized = status.toLowerCase();
  if (["blue", "success", "succeeded", "completed"].includes(normalized)) return "good";
  if (["red", "failed", "timeout"].includes(normalized)) return "bad";
  if (["building", "running"].includes(normalized)) return "warn";
  return "neutral";
}

const columns: InventoryColumn<CodeArtsBuildJob>[] = [
  {
    header: "Build task",
    render: (job) => (
      <div>
        <p className="font-black">{job.name}</p>
        <p className="mt-1 break-all text-xs text-[#98a2b3]">{job.id}</p>
      </div>
    ),
  },
  { header: "Last result", render: (job) => <InventoryStatus tone={statusTone(job.lastBuildStatus)}>{job.lastBuildStatus}</InventoryStatus> },
  { header: "Branch", render: (job) => job.branch },
  { header: "Trigger", render: (job) => job.triggerType },
  { header: "Repository", render: (job) => <span className="break-all">{job.repository}</span> },
  { header: "Last build", render: (job) => job.lastBuildAt },
  { header: "Project", render: (job) => job.projectName },
];

export default async function CodeArtsBuildPage() {
  const result = await withCloudResult<CodeArtsBuildJob[]>([], listCodeArtsBuildJobs);
  const jobs = result.data;
  const failed = jobs.filter((job) => statusTone(job.lastBuildStatus) === "bad").length;
  const running = jobs.filter((job) => statusTone(job.lastBuildStatus) === "warn").length;

  return (
    <ServiceInventoryPage
      actionLabel="Create build"
      actionTitle="Build task creation is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Build tasks, latest execution status, branch, trigger source, and repository linkage."
      empty="No CodeArts Build tasks were returned for the selected projects."
      icon={Hammer}
      result={result}
      rows={jobs}
      stats={[
        { label: "Build tasks", value: jobs.length },
        { label: "Failed or timed out", value: failed, tone: failed ? "bad" : "good" },
        { label: "Running", value: running },
        { label: "Branches", value: new Set(jobs.map((job) => job.branch).filter((branch) => branch !== "-")).size },
      ]}
      tableTitle="Build task inventory"
      title="CodeArts Build"
    />
  );
}
