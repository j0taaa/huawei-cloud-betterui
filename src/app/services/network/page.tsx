import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Network,
  Plus,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import {
  listSecurityGroups,
  listSubnets,
  listVpcs,
  withCloudResult,
} from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = {
  title: "Networking | Huawei Cloud Better UI",
};

export default async function NetworkPage() {
  const [vpcsResult, subnetsResult, groupsResult] = await Promise.all([
    withCloudResult([], listVpcs),
    withCloudResult([], listSubnets),
    withCloudResult([], listSecurityGroups),
  ]);

  const errors = [vpcsResult.error, subnetsResult.error, groupsResult.error].filter(Boolean);
  const isRefreshing =
    vpcsResult.isRefreshing ||
    subnetsResult.isRefreshing ||
    groupsResult.isRefreshing;

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={isRefreshing} />
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
                <Network className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Networking
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real VPC, subnet, and security group data.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="VPC creation is not implemented yet.">
              <Plus className="size-4" />
              Create VPC
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {errors.length ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {errors.join(" ")}
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-2">
          <NetworkTable
            columns={["Name", "CIDR", "Status"]}
            rows={vpcsResult.data.map((vpc) => ({
              href: `/services/network/vpcs/${vpc.id}`,
              id: vpc.id,
              values: [vpc.name, vpc.cidr, vpc.status],
            }))}
            title="VPCs"
            isCached={vpcsResult.isCached}
            updatedAt={vpcsResult.updatedAt}
          />
          <NetworkTable
            columns={["Name", "CIDR", "Gateway", "VPC"]}
            rows={subnetsResult.data.map((subnet) => ({
              href: `/services/network/subnets/${subnet.id}`,
              id: subnet.id,
              values: [subnet.name, subnet.cidr, subnet.gateway, subnet.vpcId],
            }))}
            title="Subnets"
            isCached={subnetsResult.isCached}
            updatedAt={subnetsResult.updatedAt}
          />
          <NetworkTable
            columns={["Name", "Rules", "Description"]}
            rows={groupsResult.data.map((group) => ({
              href: `/services/network/security-groups/${group.id}`,
              id: group.id,
              values: [group.name, String(group.rules), group.description || "-"],
            }))}
            title="Security Groups"
            isCached={groupsResult.isCached}
            updatedAt={groupsResult.updatedAt}
          />
        </section>
      </main>
    </ConsoleShell>
  );
}

function NetworkTable({
  columns,
  rows,
  isCached,
  title,
  updatedAt,
}: {
  columns: string[];
  isCached: boolean;
  rows: Array<{ href: string; id: string; values: string[] }>;
  title: string;
  updatedAt: string;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
      <div className="border-b border-[#e4e9f2] p-5">
        <h2 className="text-lg font-black">{title}</h2>
        <p className="mt-1 text-sm font-medium text-[#667085]">
          Showing {isCached ? "cached" : "fresh"} data from{" "}
          <LocalDateTime value={updatedAt} />.
        </p>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
              <tr>
                {columns.map((column) => (
                  <th className="px-5 py-3" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {rows.map((row) => (
                <tr key={row.id}>
                  {row.values.map((value, index) => (
                    <td className="px-5 py-4 font-semibold" key={`${row.id}-${index}`}>
                      {index === 0 ? (
                        <Link className="font-black text-[#2563eb]" href={row.href}>
                          {value}
                        </Link>
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid place-items-center px-6 py-12 text-center">
          <p className="text-sm font-bold text-[#667085]">No {title.toLowerCase()} found.</p>
        </div>
      )}
    </article>
  );
}
