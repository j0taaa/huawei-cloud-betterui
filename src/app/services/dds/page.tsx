import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  DatabaseBackup,
  FileJson,
  HardDrive,
  Network,
  Plus,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsolePageHeader,
  ConsolePanel,
  DataFreshnessText,
  MetricCard,
  MetricGrid,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { DdsInstancesTable } from "@/components/dds-instances-table";
import {
  listDdsInstances,
  type DdsInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DDS | Huawei Cloud Better UI",
};

export default async function DdsPage() {
  const result = await withCloudResult<DdsInstance[]>([], listDdsInstances, cloudCacheKeys.listDdsInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["normal", "available", "active", "running"].includes(
      instance.status.toLowerCase(),
    ),
  ).length;
  const nodes = instances.reduce((total, instance) => total + instance.nodes, 0);
  const regions = new Set(instances.map((instance) => instance.region));

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={(
            <>
              <DisabledCloudButton title="DDS creation is not implemented yet.">
                <Plus className="size-4" />
                Create instance
              </DisabledCloudButton>
              <DisabledCloudButton title="Manual DDS backup creation is not implemented yet.">
                <DatabaseBackup className="size-4" />
                Create backup
              </DisabledCloudButton>
              <RefreshButton />
            </>
          )}
          backHref="/services/databases"
          backLabel="Back to Databases"
          description="DDS inventory with cluster layout, network placement, backup posture, and guarded restart operations."
          icon={FileJson}
          title="Document Database Service"
        />
        {result.error ? (
          <ConsoleCallout>
            {result.error}
          </ConsoleCallout>
        ) : null}
        <MetricGrid>
          <MetricCard icon={FileJson} label="Instances" value={instances.length} />
          <MetricCard icon={DatabaseBackup} label="Healthy" value={healthy} />
          <MetricCard icon={HardDrive} label="Nodes" value={nodes} />
          <MetricCard icon={Network} label="Regions" value={regions.size} />
        </MetricGrid>
        <ConsolePanel
          description={(
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          )}
          title="Document database instances"
        >
          <DdsInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
