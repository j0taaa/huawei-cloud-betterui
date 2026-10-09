import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Braces,
  HardDrive,
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
import { GeminiDbInstancesTable } from "@/components/geminidb-instances-table";
import {
  listGeminiDbInstances,
  type GeminiDbInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "GeminiDB | Huawei Cloud Better UI",
};

export default async function GeminiDbPage() {
  const result = await withCloudResult<GeminiDbInstance[]>([], listGeminiDbInstances, cloudCacheKeys.listGeminiDbInstances);
  const instances = result.data;
  const healthy = instances.filter((instance) => instance.status.toLowerCase() === "normal").length;
  const nodes = instances.reduce((total, instance) => total + instance.nodeCount, 0);
  const apiTypes = new Set(
    instances.map((instance) => instance.apiType).filter((type) => type !== "-"),
  );
  const regions = new Set(instances.map((instance) => instance.region));

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={(
            <>
              <DisabledCloudButton title="GeminiDB creation is not implemented yet.">
                <Plus className="size-4" />
                Create instance
              </DisabledCloudButton>
              <RefreshButton />
            </>
          )}
          backHref="/services/databases"
          backLabel="Back to Databases"
          description="GeminiDB inventory with console topology, endpoint, backup, network, and guarded restart operations."
          icon={Braces}
          title="GeminiDB"
        />
        {result.error ? (
          <ConsoleCallout>
            {result.error}
          </ConsoleCallout>
        ) : null}
        <MetricGrid>
          <MetricCard icon={Braces} label="Instances" value={instances.length} />
          <MetricCard icon={Server} label="Healthy" value={healthy} />
          <MetricCard icon={HardDrive} label="Nodes" value={nodes} />
          <MetricCard icon={Network} label="Regions" value={regions.size || apiTypes.size} />
        </MetricGrid>
        <ConsolePanel
          description={(
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          )}
          title="Multi-model database instances"
        >
          <GeminiDbInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
