import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Cable, HardDrive, MessageSquareMore, Plus } from "lucide-react";

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
import { DmsKafkaInstancesTable } from "@/components/dms-kafka-instances-table";
import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import type { DmsKafkaInstanceDetails } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DMS Kafka | Huawei Cloud Better UI",
};

type ListDmsKafkaInstances = (
  session: BetterUiSession,
) => Promise<DmsKafkaInstanceDetails[]>;

const listDmsKafkaInstances =
  (
    huaweiCloud as typeof huaweiCloud & {
      listDmsKafkaInstances?: ListDmsKafkaInstances;
    }
  ).listDmsKafkaInstances ??
  (async () => {
    throw new Error(
      "listDmsKafkaInstances is not exported from @/lib/huawei-cloud yet.",
    );
  });

export default async function DmsKafkaPage() {
  const result = await withCloudResult<DmsKafkaInstanceDetails[]>(
    [],
    listDmsKafkaInstances, cloudCacheKeys.listDmsKafkaInstances,
  );
  const instances = result.data;
  const running = instances.filter((item) =>
    ["running", "available"].includes((item.status ?? "").toLowerCase()),
  ).length;
  const brokers = instances.reduce(
    (total, item) => total + (item.brokerCount ?? 0),
    0,
  );
  const partitions = instances.reduce(
    (total, item) => total + (item.partitionNum ?? 0),
    0,
  );

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="Kafka instance creation is disabled in this read-only view.">
              <Plus className="size-4" />
              Create instance
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/services/databases"
          backLabel="Back to Databases"
          description="Kafka cluster health, broker footprint, connection endpoints, and storage pressure."
          icon={MessageSquareMore}
          title="DMS Kafka"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3">
          <MetricCard icon={MessageSquareMore} label="Instances" value={instances.length} variant="compact" />
          <MetricCard icon={Cable} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Running" value={running} variant="compact" />
          <MetricCard icon={HardDrive} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Brokers" value={brokers} variant="compact" />
          <MetricCard icon={MessageSquareMore} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Partitions" value={partitions} variant="compact" />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${instances.length} instances`}
              updatedAt={result.updatedAt}
            />
          }
          title="Kafka instances"
        >
          <DmsKafkaInstancesTable instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
