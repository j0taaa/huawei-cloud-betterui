import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, DatabaseBackup, HardDrive, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { listEvsDisks, withCloudResult } from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = {
  title: "EVS | Huawei Cloud Better UI",
};

export default async function EvsPage() {
  const result = await withCloudResult([], listEvsDisks, cloudCacheKeys.listEvsDisks);
  const disks = result.data;

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
              href="/"
            >
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <HardDrive className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Elastic Volume Service
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real EVS disks for the selected project.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Disk creation is not implemented yet.">
              <Plus className="size-4" />
              Create disk
            </DisabledCloudButton>
            <DisabledCloudButton title="Snapshots are not implemented yet.">
              <DatabaseBackup className="size-4" />
              Create snapshot
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
            <h2 className="text-lg font-black">Disks</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {disks.length} disks · Showing {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {disks.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Size</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Attached to</th>
                    <th className="px-5 py-3">AZ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {disks.map((disk) => (
                    <tr key={disk.id}>
                      <td className="px-5 py-4">
                        <Link
                          className="font-black text-[#2563eb]"
                          href={`/services/evs/${disk.id}`}
                        >
                          {disk.name}
                        </Link>
                        <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
                          {disk.id}
                        </p>
                      </td>
                      <td className="px-5 py-4 font-bold">{disk.status}</td>
                      <td className="px-5 py-4 font-bold">{disk.size}</td>
                      <td className="px-5 py-4 font-bold">{disk.type}</td>
                      <td className="px-5 py-4 font-bold">{disk.attachedTo}</td>
                      <td className="px-5 py-4 font-bold">{disk.availabilityZone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <p className="text-lg font-black">No EVS disks found</p>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
