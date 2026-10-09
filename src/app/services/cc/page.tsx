import type { Metadata } from "next";
import { Network } from "lucide-react";
import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { listCloudConnections } from "@/lib/huawei/services/cc";
import { withCloudResult } from "@/lib/huawei/result";
import type { ManagementResource } from "@/lib/management-contract";

export const metadata: Metadata = { title: "Cloud Connect | Huawei Cloud Better UI" };
export default async function CloudConnectPage() {
  const result = await withCloudResult<ManagementResource[]>([], listCloudConnections, cloudCacheKeys.listCloudConnections);
  const rows = result.data;
  return <ServiceInventoryPage managementService="cc" active="Networking" backHref="/services/networking" backLabel="Back to Networking" title="Cloud Connect" tableTitle="Cloud connectivity resources" description="Account-wide cloud connections, loaded network instances, and inter-region bandwidth allocations. Manage routes and existing prepaid bandwidth capacity from the workspace." icon={Network} result={result} rows={rows} empty="No Cloud Connect resources found." columns={[
    { header: "Resource", render: row => <ResourceIdentity id={row.id} name={row.name} /> },
    { header: "Type", render: row => row.id.startsWith("cc:") ? "Cloud connection" : row.id.startsWith("ni:") ? "Network instance" : "Inter-region bandwidth" },
    { header: "State", render: row => <InventoryStatus>{row.status ?? "Unknown"}</InventoryStatus> },
    { header: "Regions", render: row => String(row.values?.regions ?? row.values?.region ?? "-") },
    { header: "Parent", render: row => String(row.values?.cloudConnection ?? "-") },
    { header: "Capacity", render: row => row.values?.bandwidth === undefined ? "-" : `${row.values.bandwidth} Mbit/s` },
  ]} stats={[
    { label: "Cloud connections", value: rows.filter(row => row.id.startsWith("cc:")).length },
    { label: "Network instances", value: rows.filter(row => row.id.startsWith("ni:")).length },
    { label: "Inter-region bandwidths", value: rows.filter(row => row.id.startsWith("irb:")).length },
  ]} />;
}
