import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CloudCog, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { listElbs, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ELB | Huawei Cloud Better UI",
};

export default async function ElbPage() {
  const result = await withCloudResult([], listElbs);
  const loadBalancers = result.data;

  return (
    <ConsoleShell active="Networking">
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <CloudCog className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Elastic Load Balance
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real load balancers for the selected project.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="ELB creation is not implemented yet.">
              <Plus className="size-4" />
              Create ELB
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
            <h2 className="text-lg font-black">Load balancers</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Last refreshed {new Date(result.updatedAt).toLocaleString()}.
            </p>
          </div>
          <ResourceTable
            empty="No load balancers found."
            rows={loadBalancers.map((elb) => ({
              href: `/services/elb/${elb.id}`,
              id: elb.id,
              values: [
                elb.name,
                elb.vipAddress,
                elb.operatingStatus,
                elb.provisioningStatus,
              ],
            }))}
            columns={["Name", "VIP", "Operating", "Provisioning"]}
          />
        </section>
      </main>
    </ConsoleShell>
  );
}

function ResourceTable({
  columns,
  empty,
  rows,
}: {
  columns: string[];
  empty: string;
  rows: Array<{ href: string; id: string; values: string[] }>;
}) {
  if (!rows.length) {
    return <div className="grid place-items-center px-6 py-16 text-center"><p className="text-lg font-black">{empty}</p></div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
          <tr>{columns.map((column) => <th className="px-5 py-3" key={column}>{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[#eef2f7]">
          {rows.map((row) => (
            <tr key={row.id}>
              {row.values.map((value, index) => (
                <td className="px-5 py-4 font-semibold" key={`${row.id}-${index}`}>
                  {index === 0 ? <Link className="font-black text-[#2563eb]" href={row.href}>{value}</Link> : value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
