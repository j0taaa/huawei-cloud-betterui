import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import Link from "next/link";
import type { Metadata } from "next";
import { Box, Database, UploadCloud } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsoleEmptyPanelBody,
  ConsolePageHeader,
  ConsolePanel,
  DataFreshnessText,
  MetricCard,
  MetricGrid,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { ObsBucketSearchTable } from "@/components/obs-search-tables";
import { listObsBuckets, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "OBS | Huawei Cloud Better UI",
};

export default async function ObsPage() {
  const result = await withCloudResult([], listObsBuckets, cloudCacheKeys.listObsBuckets);
  const buckets = result.data;
  const regions = new Set(buckets.map((bucket) => bucket.location).filter((location) => location && location !== "-"));
  const storageClasses = new Set(
    buckets
      .map((bucket) => bucket.storageClass)
      .filter((storageClass) => storageClass && storageClass !== "-"),
  );

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <Link className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white" href="/services/obs/manage">
              <Box className="size-4" />
              Create bucket
            </Link>
            <DisabledCloudButton title="Open a bucket to upload objects.">
              <UploadCloud className="size-4" />
              Upload object
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/services/storage"
          backLabel="Back to Storage"
          description="Real OBS buckets discovered through signed temporary OBS credentials."
          icon={Box}
          iconClassName="bg-[#e9f8f1] text-[#16a34a]"
          title="Object Storage Service"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3" columns={3}>
          <MetricCard icon={Box} iconClassName="bg-[#e9f8f1] text-[#16a34a]" label="Buckets" value={buckets.length} variant="compact" />
          <MetricCard icon={Database} label="Regions" value={regions.size} variant="compact" />
          <MetricCard icon={Database} iconClassName="bg-[#f5f3ff] text-[#7c3aed]" label="Storage classes" value={storageClasses.size} variant="compact" />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${buckets.length} buckets`}
              updatedAt={result.updatedAt}
            />
          }
          title="Buckets"
        >
          {buckets.length ? (
            <ObsBucketSearchTable buckets={buckets} />
          ) : (
            <ConsoleEmptyPanelBody icon={Database} title="No OBS buckets found">
              No buckets were returned for this account or OBS access is not permitted.
            </ConsoleEmptyPanelBody>
          )}
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
