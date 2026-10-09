import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { DatabaseZap, Gauge, KeyRound, Plus } from "lucide-react";

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
import { DcsInstancesTable } from "@/components/dcs-instances-table";
import { ConsoleShell } from "@/components/console-shell";
import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import type { DcsRedisInstanceDetails } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DCS Redis | Huawei Cloud Better UI",
};

type ListDcsRedisInstances = (
  session: BetterUiSession,
) => Promise<DcsRedisInstanceDetails[]>;

const listDcsRedisInstances =
  (
    huaweiCloud as typeof huaweiCloud & {
      listDcsRedisInstances?: ListDcsRedisInstances;
    }
  ).listDcsRedisInstances ??
  (async () => {
    throw new Error(
      "listDcsRedisInstances is not exported from @/lib/huawei-cloud yet.",
    );
  });

export default async function DcsRedisPage() {
  const result = await withCloudResult<DcsRedisInstanceDetails[]>(
    [],
    listDcsRedisInstances, cloudCacheKeys.listDcsRedisInstances,
  );
  const instances = result.data;
  const healthy = instances.filter((item) =>
    ["running", "normal", "available"].includes((item.status ?? "").toLowerCase()),
  ).length;
  const nodes = instances.reduce((total, item) => total + (item.nodeCount ?? 0), 0);
  const versions = new Set(instances.map((item) => item.engineVersion).filter(Boolean));

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="Redis instance creation is disabled in this read-only view.">
              <Plus className="size-4" />
              Create instance
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/services/databases"
          backLabel="Back to Databases"
          description="Redis instance state, memory pressure, topology, endpoint, and network placement."
          icon={DatabaseZap}
          iconClassName="bg-[#e9f8f1] text-[#15803d]"
          title="DCS Redis"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3">
          <MetricCard icon={DatabaseZap} iconClassName="bg-[#e9f8f1] text-[#15803d]" label="Instances" value={instances.length} variant="compact" />
          <MetricCard icon={Gauge} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Healthy" value={healthy} variant="compact" />
          <MetricCard icon={DatabaseZap} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Nodes" value={nodes} variant="compact" />
          <MetricCard icon={KeyRound} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Redis versions" value={versions.size} variant="compact" />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${instances.length} Redis instances`}
              updatedAt={result.updatedAt}
            />
          }
          title="Cache instances"
        >
          <DcsInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
