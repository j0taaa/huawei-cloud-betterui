import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { listResourcePackages, withCloudResult } from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementResource } from "@/lib/management-contract";

export const metadata: Metadata = { title: "Resource Packages | Huawei Cloud Better UI" };
export default async function PackagesPage() {
  const result = await withCloudResult<ManagementResource[]>([], listResourcePackages, cloudCacheKeys.listResourcePackages);
  const rows = result.data;
  return <ServiceInventoryPage managementService="packages" active="Billing" backHref="/services/billing" backLabel="Back to Billing" title="Resource Packages" tableTitle="Purchased resource packages" description="Purchased packages, enterprise-project scope, quota items, remaining amounts, and deduction history. Huawei omits packages expired for more than 18 months." icon={Boxes} result={result} rows={rows} empty="No purchased packages returned for the available billing scopes." columns={[
    { header: "Purchase", render: row => <ResourceIdentity id={row.id} name={row.name} /> },
    { header: "State", render: row => <InventoryStatus>{row.status ?? "Unknown"}</InventoryStatus> },
    { header: "Service", render: row => String(row.values?.service ?? "Unknown") },
    { header: "Region", render: row => String(row.values?.region ?? "Unknown") },
    { header: "Enterprise project", render: row => String(row.values?.enterpriseProject || "Unassigned") },
    { header: "Expires", render: row => String(row.values?.expires ?? "Unknown") },
    { header: "Quota items", render: row => String(row.values?.items ?? "Unknown") },
  ]} stats={[
    { label: "Packages", value: rows.length },
    { label: "In effect", value: rows.filter(row => row.status === "In effect").length },
    { label: "Used up", value: rows.filter(row => row.status === "Used up").length },
    { label: "Expired", value: rows.filter(row => row.status === "Expired").length },
  ]}>
    <p className="text-sm text-gray-600">Purchasing, renewal, and unsubscription remain service-specific workflows. <Link className="text-blue-600 underline" href="/services/billing/center/manage">Review implemented Billing Center operations</Link>.</p>
  </ServiceInventoryPage>;
}
