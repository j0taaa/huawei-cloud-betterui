import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Boxes,
  Cpu,
  HardDrive,
  ImageIcon,
  Lock,
  Share2,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import type { BetterUiSession } from "@/lib/auth-session";

export const metadata: Metadata = {
  title: "IMS | Huawei Cloud Better UI",
};

type ImsImage = {
  createdAt: string;
  id: string;
  imageType: string;
  minDisk: string;
  name: string;
  os: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
  visibility: string;
};

type ListImages = (session: BetterUiSession) => Promise<ImsImage[]>;

const listImages =
  (huaweiCloud as typeof huaweiCloud & { listImages?: ListImages }).listImages ??
  (async () => {
    throw new Error("listImages is not exported from @/lib/huawei-cloud yet.");
  });

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "active") {
    return "bg-[#e9f8f1] text-[#15803d]";
  }

  if (normalized === "killed" || normalized === "deleted") {
    return "bg-[#fff1f2] text-[#b42318]";
  }

  if (normalized === "queued" || normalized === "saving") {
    return "bg-[#fff7ed] text-[#c2410c]";
  }

  return "bg-[#eef4ff] text-[#2563eb]";
}

function imageTypeLabel(type: string) {
  const labels: Record<string, string> = {
    gold: "Public",
    market: "KooGallery",
    private: "Private",
    shared: "Shared",
  };

  return labels[type] ?? (type || "-");
}

function ImageStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusTone(status)}`}
    >
      {status || "UNKNOWN"}
    </span>
  );
}

function ImageRow({ image }: { image: ImsImage }) {
  return (
    <tr>
      <td className="px-5 py-4 align-top">
        <p className="font-black">{image.name}</p>
        <p className="mt-1 text-xs font-semibold text-[#98a2b3]">{image.id}</p>
        <p className="mt-2 text-xs font-bold text-[#667085]">
          {image.size} image size
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <ImageStatus status={image.status} />
        <p className="mt-2 text-xs font-semibold text-[#667085]">
          {imageTypeLabel(image.imageType)}
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <p className="font-black">{image.os || "-"}</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">
          {image.visibility} visibility
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <p className="inline-flex items-center gap-2">
          <HardDrive className="size-4 text-[#2563eb]" />
          {image.minDisk} minimum disk
        </p>
        <p className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-[#667085]">
          <Cpu className="size-3.5 text-[#16a34a]" />
          Check ECS flavor support before launch
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <p>{image.projectName || image.projectId}</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">{image.region}</p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <LocalDateTime value={image.createdAt} />
      </td>
    </tr>
  );
}

export default async function ImsPage() {
  const result = await withCloudResult<ImsImage[]>([], listImages);
  const images = result.data;
  const active = images.filter(
    (image) => image.status.toLowerCase() === "active",
  ).length;
  const privateImages = images.filter(
    (image) => image.imageType === "private" || image.visibility === "private",
  ).length;
  const sharedImages = images.filter(
    (image) => image.imageType === "shared" || image.visibility === "shared",
  ).length;
  const osFamilies = new Set(images.map((image) => image.os).filter(Boolean));

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
              href="/services/compute"
            >
              <ArrowLeft className="size-4" />
              Back to Compute
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <ImageIcon className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Image Management Service
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Private image catalog, status, visibility, OS, and launch disk requirements.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Image creation is disabled in this read-only view.">
              <ImageIcon className="size-4" />
              Create image
            </DisabledCloudButton>
            <DisabledCloudButton title="Image sharing is disabled in this read-only view.">
              <Share2 className="size-4" />
              Share image
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ["Images", images.length],
            ["Active", active],
            ["Private", privateImages],
            ["OS families", osFamilies.size],
          ].map(([label, value]) => (
            <div
              className="rounded-xl border border-[#e4e9f2] bg-white p-4 shadow-[0_12px_36px_rgba(16,24,40,0.04)]"
              key={label}
            >
              <p className="text-xs font-black uppercase text-[#667085]">{label}</p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 font-bold text-[#344054]">
                <Boxes className="size-4 text-[#2563eb]" />
                Shared images
              </span>
              <span className="font-black">{sharedImages}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 font-bold text-[#344054]">
                <Lock className="size-4 text-[#9333ea]" />
                Visible images
              </span>
              <span className="font-black">
                {images.filter((image) => image.visibility !== "-").length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 font-bold text-[#344054]">
                <HardDrive className="size-4 text-[#16a34a]" />
                Disk requirement set
              </span>
              <span className="font-black">
                {images.filter((image) => image.minDisk !== "0 GB").length}
              </span>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Images</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {images.length} images · Showing {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {images.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Image</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">OS / visibility</th>
                    <th className="px-5 py-3">Launch requirements</th>
                    <th className="px-5 py-3">Project / region</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {images.map((image) => (
                    <ImageRow image={image} key={`${image.region}:${image.id}`} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <ImageIcon className="mx-auto size-10 text-[#98a2b3]" />
                <p className="mt-4 text-lg font-black">No IMS images found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">
                  No private images were returned for this account, or this IAM
                  user cannot list IMS images.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
