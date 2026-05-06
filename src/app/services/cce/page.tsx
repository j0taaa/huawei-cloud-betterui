import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Boxes, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { listCceClusters, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CCE | Huawei Cloud Better UI",
};

export default async function CcePage() {
  const result = await withCloudResult([], listCceClusters);
  const clusters = result.data;

  return (
    <ConsoleShell active="Containers">
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Boxes className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Cloud Container Engine
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real CCE clusters for the selected project.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Cluster creation is not implemented yet.">
              <Plus className="size-4" />
              Create cluster
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
            <h2 className="text-lg font-black">Clusters</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Last refreshed {new Date(result.updatedAt).toLocaleString()}.
            </p>
          </div>
          {clusters.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Version</th><th className="px-5 py-3">Type</th></tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {clusters.map((cluster) => (
                    <tr key={cluster.id}>
                      <td className="px-5 py-4"><Link className="font-black text-[#2563eb]" href={`/services/cce/${cluster.id}`}>{cluster.name}</Link></td>
                      <td className="px-5 py-4 font-bold">{cluster.status}</td>
                      <td className="px-5 py-4 font-bold">{cluster.version}</td>
                      <td className="px-5 py-4 font-bold">{cluster.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center"><p className="text-lg font-black">No CCE clusters found</p></div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
