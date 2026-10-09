import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Database,
  DatabaseBackup,
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
import { RdsInstancesTable } from "@/components/rds-instances-table";
import {
  listRdsInstances,
  type RdsInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "RDS | Huawei Cloud Better UI",
};

export default async function RdsPage() {
  const result = await withCloudResult<RdsInstance[]>([], listRdsInstances, cloudCacheKeys.listRdsInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["active", "available", "normal", "running"].includes(
      instance.status.toLowerCase(),
    ),
  ).length;
  const storageTypes = new Set(
    instances
      .map((instance) => instance.storageType)
      .filter((storageType) => storageType !== "-"),
  );
  const regions = new Set(instances.map((instance) => instance.region));

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="RDS creation is not implemented yet.">
              <Plus className="size-4" />
              Create instance
            </DisabledCloudButton>
            <DisabledCloudButton title="Backup creation is not implemented yet.">
              <DatabaseBackup className="size-4" />
              Create backup
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/"
          backLabel="Back to dashboard"
          description="RDS inventory with health, topology, network, backup, and guarded operations."
          icon={Database}
          title="Relational Database Service"
        />
        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}
        <MetricGrid>
          <MetricCard icon={Database} label="Instances" value={instances.length} />
          <MetricCard icon={DatabaseBackup} label="Healthy" value={healthy} />
          <MetricCard icon={HardDrive} label="Storage types" value={storageTypes.size} />
          <MetricCard icon={Network} label="Regions" value={regions.size} />
        </MetricGrid>
        <ConsolePanel
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          title="Database instances"
        >
          <RdsInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
