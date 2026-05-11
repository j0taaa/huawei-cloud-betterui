import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Database, DatabaseBackup, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { listRdsInstances, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "RDS | Huawei Cloud Better UI",
};

export default async function RdsPage() {
  const result = await withCloudResult([], listRdsInstances);
  const instances = result.data;

  return (
    <ConsoleShell active="Databases">
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Database className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Relational Database Service
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real RDS instances for the selected project.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="RDS creation is not implemented yet.">
              <Plus className="size-4" />
              Create instance
            </DisabledCloudButton>
            <DisabledCloudButton title="Backup creation is not implemented yet.">
              <DatabaseBackup className="size-4" />
              Create backup
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
            <h2 className="text-lg font-black">Database instances</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Last refreshed {new Date(result.updatedAt).toLocaleString()}.
            </p>
          </div>
          {instances.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Datastore</th><th className="px-5 py-3">Private IP</th><th className="px-5 py-3">Type</th></tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {instances.map((instance) => (
                    <tr key={instance.id}>
                      <td className="px-5 py-4"><Link className="font-black text-[#2563eb]" href={`/services/rds/${instance.id}`}>{instance.name}</Link></td>
                      <td className="px-5 py-4 font-bold">{instance.status}</td>
                      <td className="px-5 py-4 font-bold">{instance.datastore}</td>
                      <td className="px-5 py-4 font-bold">{instance.privateIp}</td>
                      <td className="px-5 py-4 font-bold">{instance.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center"><p className="text-lg font-black">No RDS instances found</p></div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
