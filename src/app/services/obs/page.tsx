import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Box, Database, UploadCloud } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { ObsBucketSearchTable } from "@/components/obs-search-tables";
import { listObsBuckets, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "OBS | Huawei Cloud Better UI",
};

export default async function ObsPage() {
  const result = await withCloudResult([], listObsBuckets, cloudCacheKeys.listObsBuckets);
  const buckets = result.data;

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/storage">
              <ArrowLeft className="size-4" />
              Back to Storage
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                <Box className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">Object Storage Service</h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real OBS buckets discovered through signed temporary OBS credentials.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Bucket creation is not implemented yet.">
              <Box className="size-4" />
              Create bucket
            </DisabledCloudButton>
            <DisabledCloudButton title="Object upload is not implemented yet.">
              <UploadCloud className="size-4" />
              Upload object
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Buckets</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {buckets.length} buckets · Showing {result.isCached ? "cached" : "fresh"} data from <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {buckets.length ? (
            <ObsBucketSearchTable buckets={buckets} />
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <Database className="mx-auto size-10 text-[#98a2b3]" />
                <p className="mt-4 text-lg font-black">No OBS buckets found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">
                  No buckets were returned for this account or OBS access is not permitted.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
