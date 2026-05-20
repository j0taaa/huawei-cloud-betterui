import type { Metadata } from "next";
import Link from "next/link";
import {
  ArchiveRestore,
  ArrowLeft,
  DatabaseBackup,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import type { BetterUiSession } from "@/lib/auth-session";

export const metadata: Metadata = {
  title: "CBR | Huawei Cloud Better UI",
};

type CbrVault = {
  allocated: string;
  autoBind: string;
  createdAt: string;
  id: string;
  name: string;
  objectType: string;
  projectId: string;
  projectName: string;
  providerId: string;
  region: string;
  resources: number;
  size: string;
  status: string;
};

type ListCbrVaults = (session: BetterUiSession) => Promise<CbrVault[]>;

const listCbrVaults =
  (huaweiCloud as typeof huaweiCloud & { listCbrVaults?: ListCbrVaults })
    .listCbrVaults ??
  (async () => {
    throw new Error(
      "listCbrVaults is not exported from @/lib/huawei-cloud yet.",
    );
  });

function numberFromSize(value: string) {
  const match = value.match(/[\d.]+/);

  return match ? Number(match[0]) : 0;
}

function objectTypeLabel(value: string) {
  const labels: Record<string, string> = {
    disk: "EVS disk backup",
    file: "File backup",
    rds: "RDS backup",
    server: "Server backup",
    turbo: "SFS Turbo backup",
    vmware: "VMware backup",
    workspace: "Workspace backup",
  };

  return labels[value] ?? (value || "-");
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "available") {
    return "bg-[#e9f8f1] text-[#15803d]";
  }

  if (normalized === "error" || normalized === "frozen") {
    return "bg-[#fff1f2] text-[#b42318]";
  }

  if (normalized === "lock") {
    return "bg-[#fff7ed] text-[#c2410c]";
  }

  return "bg-[#eef4ff] text-[#2563eb]";
}

function VaultStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${statusTone(status)}`}
    >
      {status || "UNKNOWN"}
    </span>
  );
}

function VaultRow({ vault }: { vault: CbrVault }) {
  const allocated = numberFromSize(vault.allocated);
  const size = numberFromSize(vault.size);
  const usage = size > 0 ? Math.min(100, Math.round((allocated / size) * 100)) : 0;

  return (
    <tr>
      <td className="px-5 py-4 align-top">
        <p className="font-black">{vault.name}</p>
        <p className="mt-1 text-xs font-semibold text-[#98a2b3]">{vault.id}</p>
        <p className="mt-2 text-xs font-bold text-[#667085]">
          Provider {vault.providerId}
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <VaultStatus status={vault.status} />
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#667085]">
          <LockKeyhole className="size-3.5" />
          Auto-bind {vault.autoBind}
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <p className="font-black">{objectTypeLabel(vault.objectType)}</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">
          {vault.resources} associated resources
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <div className="h-2 w-44 overflow-hidden rounded-full bg-[#eef2f7]">
          <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${usage}%` }} />
        </div>
        <p className="mt-2 font-black">{vault.allocated} allocated</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">
          {vault.size} vault size
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <p>{vault.projectName || vault.projectId}</p>
        <p className="mt-1 text-xs font-semibold text-[#667085]">
          {vault.region}
        </p>
      </td>
      <td className="px-5 py-4 align-top font-bold">
        <LocalDateTime value={vault.createdAt} />
      </td>
    </tr>
  );
}

export default async function CbrPage() {
  const result = await withCloudResult<CbrVault[]>([], listCbrVaults);
  const vaults = result.data;
  const available = vaults.filter(
    (vault) => vault.status.toLowerCase() === "available",
  ).length;
  const resources = vaults.reduce((total, vault) => total + vault.resources, 0);
  const objectTypes = new Set(vaults.map((vault) => vault.objectType).filter(Boolean));

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
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <ArchiveRestore className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Cloud Backup and Recovery
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Backup vault capacity, protected object types, and associated resources.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Vault creation is disabled in this read-only view.">
              <DatabaseBackup className="size-4" />
              Create vault
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
            ["Vaults", vaults.length],
            ["Available", available],
            ["Protected resources", resources],
            ["Object types", objectTypes.size],
          ].map(([label, value]) => (
            <div
              className="rounded-xl border border-[#e4e9f2] bg-white p-4 shadow-[0_12px_36px_rgba(16,24,40,0.04)]"
              key={label}
            >
              <p className="text-xs font-black uppercase text-[#667085]">{label}</p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Vault inventory</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {vaults.length} vaults · Showing {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {vaults.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Vault</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Protection scope</th>
                    <th className="px-5 py-3">Capacity</th>
                    <th className="px-5 py-3">Project / region</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {vaults.map((vault) => (
                    <VaultRow key={vault.id} vault={vault} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <ShieldCheck className="mx-auto size-10 text-[#98a2b3]" />
                <p className="mt-4 text-lg font-black">No CBR vaults found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">
                  No backup vaults were returned for this account, or this IAM
                  user cannot list CBR vaults.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
