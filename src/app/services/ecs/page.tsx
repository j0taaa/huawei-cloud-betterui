import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus, Server, TerminalSquare } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";
import { EcsInstanceActions } from "@/components/ecs-instance-actions";
import { listEcsInstances, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ECS | Huawei Cloud Better UI",
  description: "Elastic Cloud Server management page.",
};

const statusClasses: Record<string, string> = {
  ACTIVE: "bg-[#e9f8f1] text-[#15803d]",
  ERROR: "bg-[#fff1f2] text-[#b42318]",
  SHUTOFF: "bg-[#f2f4f7] text-[#667085]",
};

export default async function EcsPage() {
  const result = await withCloudResult([], listEcsInstances);
  const instances = result.data;
  const running = instances.filter((instance) => instance.status === "ACTIVE");

  return (
    <ConsoleShell active="Compute">
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eaf2ff] text-[#2563eb]">
                <Server className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Elastic Cloud Server
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Real ECS instances for the selected project.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="ECS creation is not implemented yet.">
              <Plus className="size-4" />
              Create ECS
            </DisabledCloudButton>
            <DisabledCloudButton title="Remote login is not implemented yet.">
              <TerminalSquare className="size-4" />
              Remote login
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
            ["Instances", instances.length, "Total ECS instances"],
            ["Running", running.length, "ACTIVE status"],
            ["Stopped", instances.length - running.length, "Not ACTIVE"],
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
            <h2 className="text-lg font-black">Instances</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              Last refreshed {new Date(result.updatedAt).toLocaleString()}.
            </p>
          </div>

          {instances.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Flavor</th>
                    <th className="px-5 py-3">Private IP</th>
                    <th className="px-5 py-3">Public IP</th>
                    <th className="px-5 py-3">AZ</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {instances.map((instance) => (
                    <tr key={instance.id}>
                      <td className="px-5 py-4">
                        <Link
                          className="font-black text-[#2563eb]"
                          href={`/services/ecs/${instance.id}`}
                        >
                          {instance.name}
                        </Link>
                        <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
                          {instance.id}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-black ${
                            statusClasses[instance.status] ??
                            "bg-[#eef4ff] text-[#2563eb]"
                          }`}
                        >
                          {instance.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {instance.flavor}
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {instance.privateIp}
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {instance.publicIp}
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {instance.availabilityZone}
                      </td>
                      <td className="px-5 py-4">
                        <EcsInstanceActions
                          id={instance.id}
                          projectId={instance.projectId}
                          status={instance.status}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <p className="text-lg font-black">No ECS instances found</p>
              <p className="mt-2 max-w-md text-sm font-medium text-[#667085]">
                This project returned an empty ECS list, or the IAM user lacks
                ECS list permissions.
              </p>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
