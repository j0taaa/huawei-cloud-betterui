import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { BellRing, Radio, ShieldCheck } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
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
import type { BetterUiSession } from "@/lib/auth-session";
import { CreateSmnTopicButton } from "@/components/smn-topic-actions";
import { SmnTopicsTable } from "@/components/smn-topics-table";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SMN | Huawei Cloud Better UI",
};

type SmnTopic = {
  displayName?: string;
  enterpriseProjectId?: string;
  id?: string;
  name: string;
  projectId?: string;
  projectName?: string;
  pushPolicy?: number | string;
  region?: string;
  subscriptionsConfirmed?: number;
  subscriptionsTotal?: number;
  topicUrn: string;
  updatedAt?: string;
};

type ListSmnTopics = (session: BetterUiSession) => Promise<SmnTopic[]>;

const listSmnTopics =
  (huaweiCloud as typeof huaweiCloud & { listSmnTopics?: ListSmnTopics })
    .listSmnTopics ??
  (async () => {
    throw new Error("listSmnTopics is not exported from @/lib/huawei-cloud yet.");
  });

export default async function SmnPage() {
  const result = await withCloudResult<SmnTopic[]>([], listSmnTopics, cloudCacheKeys.listSmnTopics);
  const topics = result.data;
  const confirmedSubscriptions = topics.reduce(
    (total, topic) => total + (topic.subscriptionsConfirmed ?? 0),
    0,
  );
  const totalSubscriptions = topics.reduce(
    (total, topic) => total + (topic.subscriptionsTotal ?? 0),
    0,
  );
  const enterpriseProjects = new Set(
    topics.map((topic) => topic.enterpriseProjectId).filter(Boolean),
  );
  const projects = Array.from(
    new Map(
      topics.map((topic) => [
        topic.projectId ?? "",
        {
          label: `${topic.projectName || topic.projectId || "Current project"}${
            topic.region ? ` / ${topic.region}` : ""
          }`,
          value: topic.projectId ?? "",
        },
      ]),
    ).values(),
  );

  return (
    <ConsoleShell active="Monitoring">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <CreateSmnTopicButton
              projects={projects.length ? projects : [{ label: "Current project", value: "" }]}
            />
            <RefreshButton />
            </>
          }
          backHref="/services/monitoring"
          backLabel="Back to Monitoring"
          description="Notification topics, subscription readiness, push policy, and project ownership."
          icon={BellRing}
          iconClassName="bg-[#fff7ed] text-[#c2410c]"
          title="Simple Message Notification"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3">
          <MetricCard icon={BellRing} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Topics" value={topics.length} variant="compact" />
          <MetricCard icon={Radio} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Subscriptions" value={totalSubscriptions} variant="compact" />
          <MetricCard icon={ShieldCheck} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Confirmed" value={confirmedSubscriptions} variant="compact" />
          <MetricCard icon={ShieldCheck} iconClassName="bg-[#f5f3ff] text-[#7c3aed]" label="Enterprise projects" value={enterpriseProjects.size} variant="compact" />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${topics.length} topics`}
              updatedAt={result.updatedAt}
            />
          }
          title="Notification topics"
        >
          <SmnTopicsTable topics={topics} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
