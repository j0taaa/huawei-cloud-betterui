import type { Metadata } from "next";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { ConsolePanel, ConsolePanelBody, FieldGrid, ResourceIdentity } from "@/components/console-ui";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { listWorkspaceResources, listWorkspaceTenants, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "Workspace | Huawei Cloud Better UI" };
export default async function WorkspacePage() {
  const [result, configuration] = await Promise.all([
    withCloudResult<Awaited<ReturnType<typeof listWorkspaceResources>>>([], listWorkspaceResources, cloudCacheKeys.listWorkspaceResources),
    withCloudResult<Awaited<ReturnType<typeof listWorkspaceTenants>>>([], listWorkspaceTenants, cloudCacheKeys.listWorkspaceTenants),
  ]);
  const rows = result.data;
  return <ServiceInventoryPage managementService="workspace" actionLabel="Create desktop" active="Security" backHref="/services/security" backLabel="Back to Security" title="Workspace" tableTitle="Desktops, users, and pools" description="Cloud desktop inventory, user accounts, pool configuration, and verified lifecycle operations." icon={Monitor} result={result} rows={rows} rowKey={row => `${row.projectId}:${row.id}`} empty="No Workspace resources found." tone="red" columns={[
    { header: "Resource", render: row => <ResourceIdentity id={row.id} name={row.name} /> },
    { header: "Type", render: row => row.id.startsWith("desktop:") ? "Desktop" : row.id.startsWith("user:") ? "User" : "Pool" },
    { header: "State", render: row => <InventoryStatus>{row.status ?? "Unknown"}</InventoryStatus> },
    { header: "Assignment", render: row => String(row.values?.user ?? row.values?.type ?? "-") },
    { header: "Desktops", render: row => row.values?.desktops === undefined ? "-" : String(row.values.desktops) },
    { header: "Project", render: row => `${row.projectName} · ${row.region}` },
  ]} stats={[
    { label: "Desktops", value: rows.filter(row => row.id.startsWith("desktop:")).length },
    { label: "Users", value: rows.filter(row => row.id.startsWith("user:")).length },
    { label: "Pools", value: rows.filter(row => row.id.startsWith("pool:")).length },
    { label: "Tenant records", value: configuration.data.length },
  ]}>
    <ConsolePanel title="Tenant configuration"><ConsolePanelBody>
      {configuration.error ? <p role="alert" className="mb-3 text-sm text-red-700">{configuration.error}</p> : null}
      <FieldGrid items={configuration.data.map(tenant => ({ label: `${tenant.projectName} · ${tenant.region}`, value: `${tenant.status} · ${tenant.accessMode} · ${tenant.subnetCount} service subnets` }))} />
      <Link className="mt-4 inline-block text-sm text-blue-600 underline" href="/services/workspace/configuration">View tenant networking and access configuration</Link>
    </ConsolePanelBody></ConsolePanel>
  </ServiceInventoryPage>;
}
