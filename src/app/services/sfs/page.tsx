import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Database,
  FolderTree,
  HardDrive,
  Lock,
  Network,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import {
  withCloudResult,
  listSfsShares,
  type SfsShare,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SFS | Huawei Cloud Better UI",
};

function numberFromSize(value: string) {
  const match = value.match(/[\d.]+/);

  return match ? Number(match[0]) : 0;
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "available") {
    return "bg-[#e9f8f1] text-[#15803d]";
  }

  if (normalized.includes("error")) {
    return "bg-[#fff1f2] text-[#b42318]";
  }

  if (
    normalized.includes("creating") ||
    normalized.includes("deleting") ||
    normalized.includes("extending")
  ) {
    return "bg-[#fff7ed] text-[#c2410c]";
  }

  return "bg-[#eef4ff] text-[#2563eb]";
}

function ShareStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusTone(status)}`}
    >
      {status || "UNKNOWN"}
    </span>
  );
}

function ShareRow({ share }: { share: SfsShare }) {
  return (
    <tr>
      <td className="px-5 py-4 align-top">
        <p className="font-black">{share.name}</p>
        <p className="mt-1 text-xs font-semibold text-[#98a2b3]">{share.id}</p>
        <p className="mt-2 text-xs font-bold text-[#667085]">
          {share.shareType || "Default share type"}
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <ShareStatus status={share.status} />
      </td>
      <td className="px-5 py-4 align-top">
        <p className="font-black">{share.protocol || "-"}</p>
        <p className="mt-1 max-w-96 break-all text-xs font-semibold text-[#667085]">
          {share.exportLocation || "Mount path not returned"}
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">{share.size}</td>
      <td className="px-5 py-4 align-top font-bold">
        <p>{share.availabilityZone || "-"}</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">
          {share.region}
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <p>{share.projectName || share.projectId}</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">
          {share.projectId}
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <LocalDateTime value={share.createdAt} />
      </td>
    </tr>
  );
}

export default async function SfsPage() {
  const result = await withCloudResult<SfsShare[]>(
    [],
    listSfsShares,
    cloudCacheKeys.listSfsShares,
  );
  const shares = result.data;
  const totalGb = shares.reduce(
    (total, share) => total + numberFromSize(share.size),
    0,
  );
  const available = shares.filter(
    (share) => share.status.toLowerCase() === "available",
  ).length;
  const withExports = shares.filter(
    (share) => share.exportLocation !== "-",
  ).length;
  const protocols = new Set(
    shares.map((share) => share.protocol).filter(Boolean),
  );

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
              href="/services/storage"
            >
              <ArrowLeft className="size-4" />
              Back to Storage
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                <FolderTree className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Scalable File Service
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Shared file systems, export paths, protocols, capacity, and
                  availability zones.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="File system creation is disabled in this read-only view.">
              <FolderTree className="size-4" />
              Create file system
            </DisabledCloudButton>
            <DisabledCloudButton title="ACL changes are disabled in this read-only view.">
              <Lock className="size-4" />
              Manage ACL
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">Fleet capacity</h2>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  {shares.length} file systems · {Math.round(totalGb)} GB
                  provisioned
                </p>
              </div>
              <HardDrive className="size-6 text-[#16a34a]" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="border-l-4 border-[#16a34a] pl-3">
                <p className="text-2xl font-black">{available}</p>
                <p className="text-xs font-bold uppercase text-[#667085]">
                  Available
                </p>
              </div>
              <div className="border-l-4 border-[#2563eb] pl-3">
                <p className="text-2xl font-black">{withExports}</p>
                <p className="text-xs font-bold uppercase text-[#667085]">
                  Mount paths
                </p>
              </div>
              <div className="border-l-4 border-[#9333ea] pl-3">
                <p className="text-2xl font-black">{protocols.size}</p>
                <p className="text-xs font-bold uppercase text-[#667085]">
                  Protocols
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
            <h2 className="text-lg font-black">Mount readiness</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-2 font-bold text-[#344054]">
                  <Network className="size-4 text-[#2563eb]" />
                  NFS shares
                </span>
                <span className="font-black">
                  {shares.filter((share) => share.protocol === "NFS").length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-2 font-bold text-[#344054]">
                  <FolderTree className="size-4 text-[#16a34a]" />
                  Export path returned
                </span>
                <span className="font-black">{withExports}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-2 font-bold text-[#344054]">
                  <Lock className="size-4 text-[#9333ea]" />
                  Needs access rules before mount
                </span>
                <span className="font-black">{shares.length}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">File systems</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {shares.length} shares · Showing{" "}
              {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {shares.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">File system</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Protocol / export</th>
                    <th className="px-5 py-3">Size</th>
                    <th className="px-5 py-3">AZ / region</th>
                    <th className="px-5 py-3">Project</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {shares.map((share) => (
                    <ShareRow key={share.id} share={share} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <Database className="mx-auto size-10 text-[#98a2b3]" />
                <p className="mt-4 text-lg font-black">
                  No SFS file systems found
                </p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">
                  No shared file systems were returned for this account, or this
                  IAM user cannot list SFS shares.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
