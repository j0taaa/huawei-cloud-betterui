import { FileAudio, FileText, FileVideo, ImageIcon } from "lucide-react";
import type { ObsObjectDetail } from "@/lib/huawei-cloud";

export function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-[#eef2f7] py-3 last:border-0 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-xs font-black uppercase tracking-wide text-[#667085]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-[#101828]">
        {value || "-"}
      </dd>
    </div>
  );
}

export function Preview({ object }: { object: ObsObjectDetail }) {
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
          <img
            alt={object.key}
            className="max-h-[720px] max-w-full rounded-lg object-contain"
            src={downloadUrl}
          />
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
        <iframe
          className="h-[720px] w-full bg-white"
          src={downloadUrl}
          title={object.key}
        />
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
          <audio
            className="w-full max-w-3xl"
            controls
            preload="metadata"
            src={downloadUrl}
          >
            <a className="text-white underline" href={downloadUrl}>
              Download audio
            </a>
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
          <video
            className="max-h-[720px] w-full max-w-5xl rounded-lg"
            controls
            preload="metadata"
            src={downloadUrl}
          >
            <a className="text-white underline" href={downloadUrl}>
              Download video
            </a>
          </video>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
      <h2 className="text-lg font-black">Preview unavailable</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
        This object type is not safely previewable in the browser. Use Download
        to inspect it locally.
      </p>
    </section>
  );
}
