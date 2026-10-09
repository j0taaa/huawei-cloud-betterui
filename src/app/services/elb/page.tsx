import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  CloudCog,
  Globe2,
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
import { ElbLoadBalancersTable } from "@/components/elb-load-balancers-table";
import { listElbs, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ELB | Huawei Cloud Better UI",
};

export default async function ElbPage() {
  const result = await withCloudResult([], listElbs, cloudCacheKeys.listElbs);
  const loadBalancers = result.data;
  const onlineCount = loadBalancers.filter(
    (elb) => elb.operatingStatus === "ONLINE",
  ).length;
  const listenerCount = loadBalancers.reduce(
    (total, elb) => total + elb.listenerCount,
    0,
  );
  const backendPoolCount = loadBalancers.reduce(
    (total, elb) => total + elb.backendPoolCount,
    0,
  );

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="ELB creation is not implemented yet.">
              <Plus className="size-4" />
              Create ELB
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/"
          backLabel="Back to dashboard"
          description="Load balancers, VIPs, listeners, and backend pool counts across selected projects."
          icon={CloudCog}
          title="Elastic Load Balance"
        />
        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}
        <MetricGrid>
          <MetricCard
            icon={CloudCog}
            label="Load balancers"
            value={loadBalancers.length}
          />
          <MetricCard
            icon={Globe2}
            iconClassName="bg-[#f0fdf4] text-[#166534]"
            label="Online"
            value={onlineCount}
          />
          <MetricCard
            icon={Network}
            label="Listeners"
            value={listenerCount}
          />
          <MetricCard
            icon={Server}
            label="Backend pools"
            value={backendPoolCount}
          />
        </MetricGrid>
        <ConsolePanel
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          title="Load balancers"
        >
          <ElbLoadBalancersTable loadBalancers={loadBalancers} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
