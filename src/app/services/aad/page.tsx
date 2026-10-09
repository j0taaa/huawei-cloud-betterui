import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { ServiceInventoryPage, type InventoryColumn } from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { listAadProtection, type AadProtectionResource, withCloudResult } from "@/lib/huawei-cloud";
export const metadata: Metadata = { title: "Anti-DDoS | Huawei Cloud Better UI" };
const columns: InventoryColumn<AadProtectionResource>[] = [
  { header: "Protection resource", render: item => <ResourceIdentity id={item.id} name={item.name} /> },
  { header: "Type", render: item => item.kind },
  { header: "Scope", render: item => item.projectName },
  { header: "Region", render: item => item.region },
];
export default async function AadPage() {
  const result = await withCloudResult<AadProtectionResource[]>([], listAadProtection, cloudCacheKeys.listAadProtection);
  return <ServiceInventoryPage managementService="aad" active="Security" backHref="/services/security" backLabel="Back to Security" title="Anti-DDoS" icon={ShieldAlert} description="Account-wide protection packages, policies, and protected IPs, alongside project-scoped high-defense instances and domains. Native management covers selected protection and forwarding workflows." result={result} rows={result.data} columns={columns} tableTitle="Protection resources" empty="No Anti-DDoS protection resources were returned." stats={[{ label: "Resources", value: result.data.length }, { label: "Packages", value: result.data.filter(item => item.kind === "Protection package").length }, { label: "Instances", value: result.data.filter(item => item.kind === "High-defense instance").length }, { label: "Domains", value: result.data.filter(item => item.kind === "Protected domain").length }]} />;
}
