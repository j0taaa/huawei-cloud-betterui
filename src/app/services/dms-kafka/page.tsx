import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Cable, HardDrive, MessageSquareMore, Plus } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DMS Kafka | Huawei Cloud Better UI",
};

type DmsKafkaInstance = {
  availabilityZones?: string[];
  brokerNum?: number;
  brokerCount?: number;
  connectAddress?: string;
  createdAt?: string;
  engineVersion?: string;
  id: string;
  name: string;
  partitionNum?: number;
  privateConnectAddress?: string;
  projectId?: string;
  projectName?: string;
  publicConnectAddress?: string;
  region?: string;
  securityGroupId?: string;
  sslConnectAddress?: string;
  status?: string;
  storage?: string;
  storageSpace?: string;
  storageSpecCode?: string;
  subnetId?: string;
  usedStorageSpace?: string;
  vpcId?: string;
};

type ListDmsKafkaInstances = (
  session: BetterUiSession,
) => Promise<DmsKafkaInstance[]>;

const listDmsKafkaInstances =
  (
    huaweiCloud as typeof huaweiCloud & {
      listDmsKafkaInstances?: ListDmsKafkaInstances;
    }
  ).listDmsKafkaInstances ??
  (async () => {
    throw new Error(
      "listDmsKafkaInstances is not exported from @/lib/huawei-cloud yet.",
    );
  });

function statusTone(status = "") {
  const normalized = status.toLowerCase();

  if (["running", "available"].includes(normalized)) {
    return "bg-[#e9f8f1] text-[#15803d]";
  }

  if (["faulty", "error", "failed"].includes(normalized)) {
    return "bg-[#fff1f2] text-[#b42318]";
  }

  if (["creating", "starting", "restarting", "upgrading"].includes(normalized)) {
    return "bg-[#fff7ed] text-[#c2410c]";
  }

  return "bg-[#eef4ff] text-[#2563eb]";
}

function numberFromText(value?: string) {
  const match = value?.match(/[\d.]+/);

  return match ? Number(match[0]) : 0;
}

function StorageGauge({ instance }: { instance: DmsKafkaInstance }) {
  const totalText = instance.storageSpace || instance.storage;
  const used = numberFromText(instance.usedStorageSpace);
  const total = numberFromText(totalText);
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <div className="min-w-44">
      <div className="h-2 overflow-hidden rounded-full bg-[#eef2f7]">
        <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 font-black">{instance.usedStorageSpace || "-"} used</p>
      <p className="mt-1 text-xs font-semibold text-[#667085]">
        {totalText || "-"} total · {instance.storageSpecCode || "storage spec not reported"}
      </p>
    </div>
  );
}

export default async function DmsKafkaPage() {
  const result = await withCloudResult<DmsKafkaInstance[]>(
    [],
    listDmsKafkaInstances,
  );
  const instances = result.data;
  const running = instances.filter((item) =>
    ["running", "available"].includes((item.status ?? "").toLowerCase()),
  ).length;
  const brokers = instances.reduce(
    (total, item) => total + (item.brokerNum ?? item.brokerCount ?? 0),
    0,
  );
  const partitions = instances.reduce(
    (total, item) => total + (item.partitionNum ?? 0),
    0,
  );

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/databases">
              <ArrowLeft className="size-4" />
              Back to Databases
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <MessageSquareMore className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">DMS Kafka</h1>
                <p className="mt-1 max-w-3xl text-sm font-medium text-[#667085]">
                  Kafka cluster health, broker footprint, connection endpoints, and storage pressure.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Kafka instance creation is disabled in this read-only view.">
              <Plus className="size-4" />
              Create instance
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
            ["Instances", instances.length],
            ["Running", running],
            ["Brokers", brokers],
            ["Partitions", partitions],
          ].map(([label, value]) => (
            <div className="rounded-xl border border-[#e4e9f2] bg-white p-4 shadow-[0_12px_36px_rgba(16,24,40,0.04)]" key={label}>
              <p className="text-xs font-black uppercase text-[#667085]">{label}</p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Kafka instances</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {instances.length} instances · Showing {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {instances.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Instance</th>
                    <th className="px-5 py-3">State</th>
                    <th className="px-5 py-3">Capacity</th>
                    <th className="px-5 py-3">Network</th>
                    <th className="px-5 py-3">Endpoints</th>
                    <th className="px-5 py-3">Project / region</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {instances.map((instance) => (
                    <tr className="hover:bg-[#fbfcfe]" key={instance.id}>
                      <td className="px-5 py-4 align-top">
                        <p className="font-black">{instance.name}</p>
                        <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">{instance.id}</p>
                        <p className="mt-2 text-xs font-bold text-[#667085]">Kafka {instance.engineVersion || "-"}</p>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusTone(instance.status)}`}>
                          {instance.status || "UNKNOWN"}
                        </span>
                        <p className="mt-2 text-xs font-semibold text-[#667085]">
                          {(instance.availabilityZones ?? []).join(", ") || "AZ not reported"}
                        </p>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <StorageGauge instance={instance} />
                        <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#667085]">
                          <HardDrive className="size-3.5" />
                          {instance.brokerNum ?? instance.brokerCount ?? "-"} brokers · {instance.partitionNum ?? "-"} partitions
                        </p>
                      </td>
                      <td className="px-5 py-4 align-top font-semibold">
                        <p>VPC {instance.vpcId || "-"}</p>
                        <p className="mt-1">Subnet {instance.subnetId || "-"}</p>
                        <p className="mt-1">SG {instance.securityGroupId || "-"}</p>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <p className="flex items-center gap-1 break-all font-semibold">
                          <Cable className="size-3.5 shrink-0 text-[#2563eb]" />
                          {instance.privateConnectAddress || instance.connectAddress || "-"}
                        </p>
                        <p className="mt-1 break-all text-xs font-semibold text-[#667085]">SSL {instance.sslConnectAddress || "-"}</p>
                        <p className="mt-1 break-all text-xs font-semibold text-[#667085]">Public {instance.publicConnectAddress || "-"}</p>
                      </td>
                      <td className="px-5 py-4 align-top font-semibold">
                        <p>{instance.projectName || instance.projectId || "-"}</p>
                        <p className="mt-1 text-xs text-[#667085]">{instance.region || "-"}</p>
                      </td>
                      <td className="px-5 py-4 align-top font-semibold">
                        <LocalDateTime value={instance.createdAt || ""} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <p className="text-lg font-black">No DMS Kafka instances found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">No Kafka instances were returned for the selected projects and regions.</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
