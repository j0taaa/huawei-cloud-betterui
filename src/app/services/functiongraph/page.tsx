import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Code2, Play, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { listFunctionGraphFunctions, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "FunctionGraph | Huawei Cloud Better UI",
};

export default async function FunctionGraphPage() {
  const result = await withCloudResult([], listFunctionGraphFunctions);
  const functions = result.data;

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
                <Code2 className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">FunctionGraph</h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real serverless functions from FunctionGraph for the selected projects.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Function creation is not implemented yet.">
              <Plus className="size-4" />
              Create function
            </DisabledCloudButton>
            <DisabledCloudButton title="Function invocation is not implemented yet.">
              <Play className="size-4" />
              Invoke
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
            <h2 className="text-lg font-black">Functions</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {functions.length} functions · Showing {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>

          {functions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Function</th>
                    <th className="px-5 py-3">Package</th>
                    <th className="px-5 py-3">Runtime</th>
                    <th className="px-5 py-3">Handler</th>
                    <th className="px-5 py-3">Memory</th>
                    <th className="px-5 py-3">Timeout</th>
                    <th className="px-5 py-3">Code type</th>
                    <th className="px-5 py-3">Last modified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {functions.map((item) => {
                    const functionHref = `/services/functiongraph/${encodeURIComponent(
                      item.id || item.urn || item.name,
                    )}`;

                    return (
                      <tr className="hover:bg-[#fbfcfe]" key={item.urn || item.id}>
                        <td className="px-5 py-4">
                          <Link
                            className="font-black text-[#2563eb] hover:underline"
                            href={functionHref}
                          >
                            {item.name}
                          </Link>
                          <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">
                            {item.urn}
                          </p>
                        </td>
                        <td className="px-5 py-4 font-semibold">{item.packageName}</td>
                        <td className="px-5 py-4 font-semibold">{item.runtime}</td>
                        <td className="px-5 py-4 font-semibold">{item.handler}</td>
                        <td className="px-5 py-4 font-semibold">{item.memorySize}</td>
                        <td className="px-5 py-4 font-semibold">{item.timeout}</td>
                        <td className="px-5 py-4 font-semibold">{item.codeType}</td>
                        <td className="px-5 py-4 font-semibold">
                          <LocalDateTime value={item.lastModified} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <p className="text-lg font-black">No FunctionGraph functions found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">
                  No functions were returned for the selected projects and regions.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
