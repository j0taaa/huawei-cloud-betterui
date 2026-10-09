import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Activity,
  Boxes,
  PackageCheck,
  Plus,
  Server,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { CceClustersTable } from "@/components/cce-clusters-table";
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
import { listCceClusters, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CCE | Huawei Cloud Better UI",
};

export default async function CcePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; status?: string; type?: string }>;
}) {
  const query = await searchParams;
  const result = await withCloudResult([], listCceClusters, cloudCacheKeys.listCceClusters);
  const clusters = result.data;
  const statusFilter = query.status;
  const projectFilter = query.project;
  const typeFilter = query.type;
  const filteredClusters = clusters.filter(
    (cluster) =>
      (!statusFilter || cluster.status === statusFilter) &&
      (!projectFilter || cluster.projectId === projectFilter) &&
      (!typeFilter || cluster.type === typeFilter),
  );
  const availableCount = clusters.filter(
    (cluster) => cluster.status.toLowerCase() === "available",
  ).length;
  const nodeCount = clusters.reduce((total, cluster) => total + cluster.nodeCount, 0);
  const addOnCount = clusters.reduce((total, cluster) => total + cluster.addOnCount, 0);

  return (
    <ConsoleShell active="Containers">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="Cluster creation is not implemented yet.">
              <Plus className="size-4" />
              Create cluster
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/"
          backLabel="Back to dashboard"
          description="Real CCE clusters for the selected project."
          icon={Boxes}
          title="Cloud Container Engine"
        />
        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid>
          <MetricCard
            icon={Boxes}
            label="Clusters"
            value={clusters.length}
          />
          <MetricCard
            icon={Activity}
            iconClassName="bg-[#f0fdf4] text-[#166534]"
            label="Available"
            value={availableCount}
          />
          <MetricCard
            icon={Server}
            label="Nodes"
            value={nodeCount}
          />
          <MetricCard
            icon={PackageCheck}
            label="Add-ons"
            value={addOnCount}
          />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${filteredClusters.length} of ${clusters.length} clusters`}
              updatedAt={result.updatedAt}
            />
          }
          title="Clusters"
        >
          <CceClustersTable clusters={filteredClusters} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
