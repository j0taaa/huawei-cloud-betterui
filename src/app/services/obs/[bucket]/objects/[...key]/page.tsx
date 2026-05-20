import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileAudio, FileText, FileVideo, ImageIcon } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { getObsObjectDetail, type ObsObjectDetail, withCloudResult } from "@/lib/huawei-cloud";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-[#eef2f7] py-3 last:border-0 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-xs font-black uppercase tracking-wide text-[#667085]">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-[#101828]">{value || "-"}</dd>
    </div>
  );
}

function Preview({ object }: { object: ObsObjectDetail }) {
  const downloadUrl = `/api/cloud/obs/objects?bucket=${encodeURIComponent(object.bucket)}&key=${encodeURIComponent(object.key)}`;

  if (object.previewKind === "image") {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
        <div className="border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <ImageIcon className="size-5 text-[#2563eb]" />
            Preview
          </h2>
        </div>
        <div className="grid place-items-center bg-[#0b1220] p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={object.key} className="max-h-[720px] max-w-full rounded-lg object-contain" src={downloadUrl} />
        </div>
      </section>
    );
  }

  if (object.previewKind === "text") {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
        <div className="border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <FileText className="size-5 text-[#2563eb]" />
            Preview
          </h2>
          <p className="mt-1 text-sm font-semibold text-[#667085]">
            Showing the first 64 KB for safe preview.
          </p>
        </div>
        <pre className="max-h-[720px] overflow-auto bg-[#0b1220] p-5 font-mono text-sm leading-6 text-[#e2e8f0]">
          <code>{object.previewText || "This text object is empty."}</code>
        </pre>
      </section>
    );
  }

  if (object.previewKind === "pdf") {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
        <div className="border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <FileText className="size-5 text-[#2563eb]" />
            Preview
          </h2>
        </div>
        <iframe className="h-[720px] w-full bg-white" src={downloadUrl} title={object.key} />
      </section>
    );
  }

  if (object.previewKind === "audio") {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
        <div className="border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <FileAudio className="size-5 text-[#2563eb]" />
            Preview
          </h2>
        </div>
        <div className="grid min-h-40 place-items-center bg-[#0b1220] p-5">
          <audio className="w-full max-w-3xl" controls preload="metadata" src={downloadUrl}>
            <a className="text-white underline" href={downloadUrl}>Download audio</a>
          </audio>
        </div>
      </section>
    );
  }

  if (object.previewKind === "video") {
    return (
      <section className="overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
        <div className="border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <FileVideo className="size-5 text-[#2563eb]" />
            Preview
          </h2>
        </div>
        <div className="grid place-items-center bg-[#0b1220] p-5">
          <video className="max-h-[720px] w-full max-w-5xl rounded-lg" controls preload="metadata" src={downloadUrl}>
            <a className="text-white underline" href={downloadUrl}>Download video</a>
          </video>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
      <h2 className="text-lg font-black">Preview unavailable</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
        This object type is not safely previewable in the browser. Use Download to inspect it locally.
      </p>
    </section>
  );
}

export default async function ObsObjectPage({
  params,
}: {
  params: Promise<{ bucket: string; key: string[] }>;
}) {
  const { bucket, key } = await params;
  const objectKey = key.join("/");
  const result = await withCloudResult<ObsObjectDetail | null>(
    null,
    (session) => getObsObjectDetail(session, bucket, objectKey),
    `obs-object:${bucket}:${objectKey}`,
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

export { Field, Preview };
