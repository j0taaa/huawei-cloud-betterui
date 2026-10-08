import { CloudErrorPage } from "@/components/cloud-error";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Box, FileText, Folder } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { UploadObsObjectButton } from "@/components/obs-object-actions";
import { ObsObjectSearchTable } from "@/components/obs-search-tables";
import { getObsBucket, type ObsBucketDetail, withCloudResult } from "@/lib/huawei-cloud";

export default async function ObsBucketPage({
  params,
}: {
  params: Promise<{ bucket: string }>;
}) {
  const { bucket } = await params;
  const result = await withCloudResult<ObsBucketDetail | null>(
    null,
    (session) => getObsBucket(session, bucket),
    cloudCacheKeys.obsBucket(bucket),
  );
  if (!result.data && result.error) return <CloudErrorPage active="Storage" backHref="/services/obs" error={result.error} />;
  const detail = result.data;

  if (!detail) {
    notFound();
  }

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link className="mb-4 inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/obs">
              <ArrowLeft className="size-4" />
              Back to OBS
            </Link>
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                <Box className="size-6" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">OBS bucket</p>
                <h1 className="mt-1 break-words text-3xl font-black tracking-tight">{detail.name}</h1>
                <p className="mt-1 text-xs font-bold text-[#98a2b3]">
                  Showing {result.isCached ? "cached" : "fresh"} data from <LocalDateTime value={result.updatedAt} />.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <UploadObsObjectButton bucket={detail.name} />
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        {detail.commonPrefixes.length ? (
          <section className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
            <h2 className="text-lg font-black">Folders</h2>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {detail.commonPrefixes.map((prefix) => (
                <div className="flex items-center gap-2 rounded-lg bg-[#f7f9fc] px-3 py-2 text-sm font-bold text-[#344054]" key={prefix}>
                  <Folder className="size-4 text-[#2563eb]" />
                  {prefix}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Objects</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Showing {detail.objects.length} objects returned by OBS.
            </p>
          </div>
          {detail.objects.length ? (
            <ObsObjectSearchTable bucketName={detail.name} objects={detail.objects} />
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <FileText className="mx-auto size-10 text-[#98a2b3]" />
                <p className="mt-4 text-lg font-black">No objects found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">This bucket is empty or the current credentials cannot list objects.</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
