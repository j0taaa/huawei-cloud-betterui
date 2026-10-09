import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Activity,
  Globe2,
  Plus,
  Server,
  TerminalSquare,
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
import { EcsInstancesTable } from "@/components/ecs-instances-table";
import { ConsoleShell } from "@/components/console-shell";
import { listEcsInstances, type EcsInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ECS | Huawei Cloud Better UI",
  description: "Elastic Cloud Server management page.",
};

export default async function EcsPage({
  searchParams,
}: {
  searchParams: Promise<{ az?: string; project?: string; status?: string }>;
}) {
  const query = await searchParams;
  const result = await withCloudResult<EcsInstance[]>([], listEcsInstances, cloudCacheKeys.listEcsInstances);
  const instances = result.data;
  const statusFilter = query.status;
  const projectFilter = query.project;
  const azFilter = query.az;
  const filteredInstances = instances.filter(
    (instance) =>
      (!statusFilter || instance.status === statusFilter) &&
      (!projectFilter || instance.projectId === projectFilter) &&
      (!azFilter || instance.availabilityZone === azFilter),
  );
  const runningCount = instances.filter((instance) => instance.status === "ACTIVE").length;
  const stoppedCount = instances.filter((instance) => instance.status === "SHUTOFF").length;
  const publicCount = instances.filter((instance) => instance.publicIp !== "-").length;

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="ECS creation is not implemented yet.">
              <Plus className="size-4" />
              Create ECS
            </DisabledCloudButton>
            <DisabledCloudButton title="Remote login is not implemented yet.">
              <TerminalSquare className="size-4" />
              Remote login
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/"
          backLabel="Back to dashboard"
          description="Real ECS instances for the selected project."
          icon={Server}
          iconClassName="bg-[#eaf2ff] text-[#2563eb]"
          title="Elastic Cloud Server"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid>
          <MetricCard
            icon={Server}
            label="Total ECS"
            value={instances.length}
          />
          <MetricCard
            icon={Activity}
            iconClassName="bg-[#f0fdf4] text-[#166534]"
            label="Running"
            value={runningCount}
          />
          <MetricCard
            icon={Activity}
            iconClassName="bg-[#f8fafc] text-[#475467]"
            label="Stopped"
            value={stoppedCount}
          />
          <MetricCard
            icon={Globe2}
            label="With EIP"
            value={publicCount}
          />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${filteredInstances.length} of ${instances.length} instances`}
              updatedAt={result.updatedAt}
            />
          }
          title="Instances"
        >
          <EcsInstancesTable instances={filteredInstances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
