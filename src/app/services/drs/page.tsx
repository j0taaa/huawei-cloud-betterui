import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ArrowRightLeft } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  type InventoryColumn,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listDrsJobs, type DrsJob, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DRS | Huawei Cloud Better UI",
};

export default async function DrsPage() {
  const result = await withCloudResult<DrsJob[]>([], listDrsJobs, cloudCacheKeys.listDrsJobs);
  const jobs = result.data;
  const active = jobs.filter((job) =>
    ["running", "migrating", "syncing", "normal"].includes(job.status.toLowerCase()),
  ).length;
  const failed = jobs.filter((job) =>
    ["failed", "error", "abnormal"].includes(job.status.toLowerCase()),
  ).length;
  const engines = new Set(jobs.map((job) => job.engineType).filter((engine) => engine !== "-"));

  const columns: InventoryColumn<DrsJob>[] = [
    {
      header: "Job",
      render: (job) => (
        <ResourceIdentity
          className="text-[#101828]"
          id={job.id}
          idClassName="font-normal"
          name={job.name}
        />
      ),
    },
    {
      header: "State",
      render: (job) => <InventoryStatus tone={inventoryStatusTone(job.status)}>{job.status}</InventoryStatus>,
    },
    {
      header: "Flow",
      render: (job) => (
        <CellStack subValue={job.direction}>{job.source} to {job.destination}</CellStack>
      ),
    },
    {
      header: "Scenario",
      render: (job) => (
        <CellStack subValue={job.engineType}>
          {job.jobType}
        </CellStack>
      ),
    },
    { header: "Network", render: (job) => job.networkType },
    {
      header: "Project / region",
      render: (job) => `${job.projectName} / ${job.region}`,
    },
  ];

  return (
    <ServiceInventoryPage
      actionLabel="Create job"
      actionTitle="DRS job creation is disabled in this read-only view."
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to Databases"
      columns={columns}
      description="Read-only migration, synchronization, and disaster-recovery jobs with source/target direction and engine coverage."
      empty="No DRS jobs found"
      icon={ArrowRightLeft}
      result={result}
      rows={jobs}
      stats={[
        { label: "Jobs", value: jobs.length },
        { label: "Active", value: active, tone: active ? "good" : "neutral" },
        { label: "Attention", value: failed, tone: failed ? "bad" : "good" },
        { label: "Engines", value: engines.size },
      ]}
      tableTitle="Replication jobs"
      title="Data Replication Service"
      tone="blue"
    />
  );
}
