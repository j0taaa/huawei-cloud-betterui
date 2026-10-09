import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import {
  GovernanceShell,
  StatStrip,
} from "@/app/services/_components/governance-readonly";
import { ConsolePanel, DataFreshnessText } from "@/components/console-ui";
import { LtsLogGroupsTable } from "@/components/lts-log-groups-table";
import {
  listLtsLogGroups,
  type LtsLogGroup,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "LTS | Huawei Cloud Better UI",
  description: "Read-only Log Tank Service log group operations.",
};

function ttlNumber(ttlDays: string) {
  const value = Number(ttlDays);
  return Number.isFinite(value) ? value : null;
}

export default async function LtsPage() {
  const result = await withCloudResult<LtsLogGroup[]>([], listLtsLogGroups, cloudCacheKeys.listLtsLogGroups);
  const groups = result.data;
  const shortRetention = groups.filter((group) => {
    const ttl = ttlNumber(group.ttlDays);
    return ttl !== null && ttl < 30;
  }).length;
  const longRetention = groups.filter((group) => {
    const ttl = ttlNumber(group.ttlDays);
    return ttl !== null && ttl >= 180;
  }).length;
  const tagged = groups.filter((group) => group.tags > 0).length;

  return (
    <GovernanceShell
      active="Monitoring"
      backHref="/services/monitoring"
      backLabel="Back to Monitoring"
      description="Read-only log group inventory for retention review, ownership tagging, and regional logging coverage."
      icon={ScrollText}
      result={result}
      title="Log Tank Service"
      tone="green"
    >
      <StatStrip
        items={[
          { label: "Log groups", value: groups.length, tone: "info" },
          { label: "Retention < 30d", value: shortRetention, tone: shortRetention ? "warn" : "good" },
          { label: "Retention >= 180d", value: longRetention, tone: "good" },
          { label: "Tagged groups", value: tagged, tone: tagged === groups.length ? "good" : "warn" },
        ]}
      />

      <ConsolePanel
        description={
          <DataFreshnessText
            isCached={result.isCached}
            prefix={`${groups.length} log groups`}
            updatedAt={result.updatedAt}
          />
        }
        title="Log Groups"
      >
        <LtsLogGroupsTable groups={groups} />
      </ConsolePanel>
    </GovernanceShell>
  );
}
