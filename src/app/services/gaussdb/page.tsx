import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Database,
  DatabaseBackup,
  Network,
  Plus,
  Server,
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
import { GaussDbInstancesTable } from "@/components/gaussdb-instances-table";
import {
  listGaussDbInstances,
  type GaussDbInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "GaussDB | Huawei Cloud Better UI",
};

export default async function GaussDbPage() {
  const result = await withCloudResult<GaussDbInstance[]>([], listGaussDbInstances, cloudCacheKeys.listGaussDbInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["available", "normal", "active", "running"].includes(
      instance.status.toLowerCase(),
    ),
  ).length;
  const nodes = instances.reduce(
    (total, instance) => total + instance.nodes.length,
    0,
  );
  const regions = new Set(instances.map((instance) => instance.region));

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="GaussDB creation is not implemented yet.">
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
          backHref="/services/databases"
          backLabel="Back to Databases"
          description="openGauss inventory with topology, network placement, backup posture, and guarded lifecycle actions."
          icon={Database}
          iconClassName="bg-[#e9f8f1] text-[#15803d]"
          title="GaussDB"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid>
          <MetricCard icon={Database} label="Instances" value={instances.length} iconClassName="bg-[#e9f8f1] text-[#15803d]" />
          <MetricCard icon={Server} label="Nodes" value={nodes} iconClassName="bg-[#eef4ff] text-[#2563eb]" />
          <MetricCard icon={DatabaseBackup} label="Healthy" value={healthy} iconClassName="bg-[#f0fdf4] text-[#166534]" />
          <MetricCard icon={Network} label="Regions" value={regions.size} iconClassName="bg-[#fff7ed] text-[#c2410c]" />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          title="GaussDB instances"
        >
          <GaussDbInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
