import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  DatabaseBackup,
  DatabaseZap,
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
import { TaurusDbInstancesTable } from "@/components/taurusdb-instances-table";
import {
  listTaurusDbInstances,
  type TaurusDbInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "TaurusDB | Huawei Cloud Better UI",
};

export default async function TaurusDbPage() {
  const result = await withCloudResult<TaurusDbInstance[]>(
    [],
    listTaurusDbInstances, cloudCacheKeys.listTaurusDbInstances,
  );
  const instances = result.data;
  const healthy = instances.filter((instance) =>
    ["normal", "available", "active", "running"].includes(
      instance.status.toLowerCase(),
    ),
  ).length;
  const nodes = instances.reduce(
    (total, instance) => total + instance.nodeCount,
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
            <DisabledCloudButton title="TaurusDB creation is not implemented yet.">
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
          description="TaurusDB instances with topology, network, storage, backup, and guarded lifecycle operations."
          icon={DatabaseZap}
          iconClassName="bg-[#e9f8f1] text-[#15803d]"
          title="TaurusDB"
        />
        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}
        <MetricGrid>
          <MetricCard
            icon={DatabaseZap}
            iconClassName="bg-[#e9f8f1] text-[#15803d]"
            label="Instances"
            value={instances.length}
          />
          <MetricCard icon={DatabaseBackup} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Healthy" value={healthy} />
          <MetricCard icon={HardDrive} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Nodes" value={nodes} />
          <MetricCard icon={Network} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Regions" value={regions.size} />
        </MetricGrid>
        <ConsolePanel
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          title="TaurusDB instances"
        >
          <TaurusDbInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
