import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { getObsObjectDetail, type ObsObjectDetail, withCloudResult } from "@/lib/huawei-cloud";
import { Field, Preview } from "@/app/services/obs/[bucket]/objects/[...key]/page";

export default async function ObsObjectQueryPage({
  params,
  searchParams,
}: {
  params: Promise<{ bucket: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { bucket } = await params;
  const { key = "" } = await searchParams;

  if (!key) {
    notFound();
  }

  const result = await withCloudResult<ObsObjectDetail | null>(
    null,
    (session) => getObsObjectDetail(session, bucket, key),
    `obs-object:${bucket}:${key}`,
  );
  const object = result.data;

  if (!object) {
    notFound();
  }

  const downloadUrl = `/api/cloud/obs/objects?bucket=${encodeURIComponent(object.bucket)}&key=${encodeURIComponent(object.key)}`;

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]"
              href={`/services/obs/${encodeURIComponent(object.bucket)}`}
            >
              <ArrowLeft className="size-4" />
              Back to bucket
            </Link>
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                <FileText className="size-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">OBS object</p>
                <h1 className="mt-1 break-all text-3xl font-black tracking-tight">{object.key}</h1>
                <p className="mt-1 text-xs font-bold text-[#98a2b3]">
                  Showing {result.isCached ? "cached" : "fresh"} data from <LocalDateTime value={result.updatedAt} />.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#2563eb] bg-[#2563eb] px-3 text-sm font-bold text-white shadow-sm hover:bg-[#1d4ed8]"
              href={downloadUrl}
            >
              <Download className="size-4" />
              Download
            </a>
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
          <aside className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
            <h2 className="text-lg font-black">Details</h2>
            <dl className="mt-3">
              <Field label="Bucket" value={object.bucket} />
              <Field label="Size" value={object.size} />
              <Field label="Content type" value={object.contentType} />
              <Field label="Storage class" value={object.storageClass} />
              <Field label="ETag" value={object.etag} />
              <Field label="Owner" value={object.owner} />
              <Field label="Modified" value={<LocalDateTime value={object.lastModified} />} />
            </dl>
          </aside>

          <Preview object={object} />
        </section>
      </main>
    </ConsoleShell>
  );
}
