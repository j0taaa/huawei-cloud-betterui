import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { FileSearch } from "lucide-react";

import {
  GovernanceShell,
  StatStrip,
} from "@/app/services/_components/governance-readonly";
import { ConsoleCallout, ConsolePanel, DataFreshnessText } from "@/components/console-ui";
import { CtsTrackersTable } from "@/components/cts-trackers-table";
import {
  listCtsTrackers,
  type CtsTracker,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CTS | Huawei Cloud Better UI",
  description: "Read-only Cloud Trace Service tracker operations.",
};

function enabledText(value: string) {
  return value.toLowerCase() === "true";
}

export default async function CtsPage() {
  const result = await withCloudResult<CtsTracker[]>([], listCtsTrackers, cloudCacheKeys.listCtsTrackers);
  const trackers = result.data;
  const enabled = trackers.filter((tracker) => tracker.status.toLowerCase() === "enabled").length;
  const errors = trackers.filter((tracker) => tracker.status.toLowerCase() === "error").length;
  const ltsEnabled = trackers.filter((tracker) => enabledText(tracker.isLtsEnabled)).length;
  const obsConfigured = trackers.filter((tracker) => tracker.bucketName && tracker.bucketName !== "-").length;

  return (
    <GovernanceShell
      active="Monitoring"
      backHref="/services/monitoring"
      backLabel="Back to Monitoring"
      description="Read-only tracker posture for audit trail delivery, LTS routing, and OBS archive coverage."
      icon={FileSearch}
      result={result}
      title="Cloud Trace Service"
      tone="blue"
    >
      <StatStrip
        items={[
          { label: "Trackers", value: trackers.length, tone: "info" },
          { label: "Enabled", value: enabled, tone: enabled === trackers.length ? "good" : "warn" },
          { label: "Errors", value: errors, tone: errors ? "bad" : "good" },
          { label: "OBS archives", value: obsConfigured, tone: obsConfigured ? "good" : "warn" },
        ]}
      />

      <ConsolePanel
        description={
          <DataFreshnessText
            isCached={result.isCached}
            prefix={`${trackers.length} trackers`}
            updatedAt={result.updatedAt}
          />
        }
        title="Tracker Delivery Matrix"
      >
        <CtsTrackersTable trackers={trackers} />
      </ConsolePanel>

      {trackers.length && ltsEnabled === 0 ? (
        <ConsoleCallout tone="warning">
          No tracker reports LTS delivery. Confirm whether audit search is intentionally handled from archived trace files only.
        </ConsoleCallout>
      ) : null}
    </GovernanceShell>
  );
}
