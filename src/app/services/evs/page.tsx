import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, DatabaseBackup, HardDrive, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { listEvsDisks, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "EVS | Huawei Cloud Better UI",
};

export default async function EvsPage() {
  const result = await withCloudResult([], listEvsDisks);
  const disks = result.data;
  const totalGb = disks.reduce((sum, disk) => sum + Number.parseInt(disk.size), 0);

  return (
    <ConsoleShell active="Storage">
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

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Disks", disks.length, "Total EVS disks"],
            ["Capacity", `${totalGb} GB`, "Provisioned capacity"],
            ["Attached", disks.filter((disk) => disk.attachedTo !== "-").length, "Attached disks"],
          ].map(([label, value, detail]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label}
            >
              <p className="text-sm font-bold text-[#344054]">{label}</p>
              <p className="mt-1 text-3xl font-black tracking-tight">
                {value}
              </p>
              <p className="mt-3 text-sm font-medium text-[#667085]">
                {detail}
              </p>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Disks</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Last refreshed {new Date(result.updatedAt).toLocaleString()}.
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
