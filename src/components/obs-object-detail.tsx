import { FileAudio, FileText, FileVideo, ImageIcon, type LucideIcon } from "lucide-react";
import { ConsoleDescriptionList, ConsoleSurface } from "@/components/console-ui";
import { LocalDateTime } from "@/components/local-date-time";
import type { ObsObjectDetail } from "@/lib/huawei-cloud";

function PreviewTitle({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon: LucideIcon;
}) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-5 text-[#2563eb]" />
      {children}
    </span>
  );
}

function ObsObjectDetails({ object }: { object: ObsObjectDetail }) {
  return (
    <ConsoleSurface title="Details">
      <div className="p-5">
        <ConsoleDescriptionList
          items={[
            { label: "Bucket", value: object.bucket },
            { label: "Size", value: object.size },
            { label: "Content type", value: object.contentType || "-" },
            { label: "Storage class", value: object.storageClass || "-" },
            { label: "ETag", value: object.etag || "-" },
            { label: "Owner", value: object.owner || "-" },
            { label: "Modified", value: <LocalDateTime value={object.lastModified} /> },
          ]}
        />
      </div>
    </ConsoleSurface>
  );
}

function Preview({ object }: { object: ObsObjectDetail }) {
  const downloadUrl = `/api/cloud/obs/objects?bucket=${encodeURIComponent(object.bucket)}&key=${encodeURIComponent(object.key)}`;

  if (object.previewKind === "image") {
    return (
      <ConsoleSurface title={<PreviewTitle icon={ImageIcon}>Preview</PreviewTitle>}>
        <div className="grid place-items-center bg-[#0b1220] p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={object.key} className="max-h-[720px] max-w-full rounded-lg object-contain" src={downloadUrl} />
        </div>
      </ConsoleSurface>
    );
  }

  if (object.previewKind === "text") {
    return (
      <ConsoleSurface
        description="Showing the first 64 KB for safe preview."
        title={<PreviewTitle icon={FileText}>Preview</PreviewTitle>}
      >
        <pre className="max-h-[720px] overflow-auto bg-[#0b1220] p-5 font-mono text-sm leading-6 text-[#e2e8f0]">
          <code>{object.previewText || "This text object is empty."}</code>
        </pre>
      </ConsoleSurface>
    );
  }

  if (object.previewKind === "pdf") {
    return (
      <ConsoleSurface title={<PreviewTitle icon={FileText}>Preview</PreviewTitle>}>
        <iframe className="h-[720px] w-full bg-white" src={downloadUrl} title={object.key} />
      </ConsoleSurface>
    );
  }

  if (object.previewKind === "audio") {
    return (
      <ConsoleSurface title={<PreviewTitle icon={FileAudio}>Preview</PreviewTitle>}>
        <div className="grid min-h-40 place-items-center bg-[#0b1220] p-5">
          <audio className="w-full max-w-3xl" controls preload="metadata" src={downloadUrl}>
            <a className="text-white underline" href={downloadUrl}>Download audio</a>
          </audio>
        </div>
      </ConsoleSurface>
    );
  }

  if (object.previewKind === "video") {
    return (
      <ConsoleSurface title={<PreviewTitle icon={FileVideo}>Preview</PreviewTitle>}>
        <div className="grid place-items-center bg-[#0b1220] p-5">
          <video className="max-h-[720px] w-full max-w-5xl rounded-lg" controls preload="metadata" src={downloadUrl}>
            <a className="text-white underline" href={downloadUrl}>Download video</a>
          </video>
        </div>
      </ConsoleSurface>
    );
  }

  return (
    <ConsoleSurface title="Preview unavailable">
      <p className="p-5 text-sm font-semibold leading-6 text-[#667085]">
        This object type is not safely previewable in the browser. Use Download to inspect it locally.
      </p>
    </ConsoleSurface>
  );
}


export { ObsObjectDetails, Preview };
