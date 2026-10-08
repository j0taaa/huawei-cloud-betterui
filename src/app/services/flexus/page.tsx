import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ServerCog } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import {
  listFlexusResources,
  type FlexusResource,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "Flexus | Huawei Cloud Better UI",
};

const columns: InventoryColumn<FlexusResource>[] = [
  {
    header: "Resource",
    render: (resource) => (
      <div>
        <p className="font-black">{resource.name}</p>
        <p className="mt-1 break-all text-xs text-[#98a2b3]">{resource.id}</p>
      </div>
    ),
  },
  { header: "Source", render: (resource) => <InventoryStatus>{resource.sourceService}</InventoryStatus> },
  { header: "Status", render: (resource) => <InventoryStatus>{resource.status}</InventoryStatus> },
  { header: "Flexus signal", render: (resource) => resource.signal },
  { header: "Private IP", render: (resource) => resource.privateIp },
  { header: "Public IP", render: (resource) => resource.publicIp },
  { header: "Project", render: (resource) => `${resource.projectName} / ${resource.region}` },
];

export default async function FlexusPage() {
  const result = await withCloudResult<FlexusResource[]>([], listFlexusResources, cloudCacheKeys.listFlexusResources);
  const resources = result.data;
  const compute = resources.filter((resource) => resource.sourceService === "ECS").length;
  const database = resources.filter((resource) => resource.sourceService === "RDS").length;

  return (
    <ServiceInventoryPage
      actionLabel="Purchase Flexus"
      actionTitle="Flexus purchase is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Read-only Flexus rollup from documented ECS and RDS inventory APIs, filtered by Flexus/HCSS/HECS resource signals."
      empty="No Flexus-like ECS or RDS resources were returned by the documented inventory APIs."
      icon={ServerCog}
      result={result}
      rows={resources}
      stats={[
        { label: "Flexus resources", value: resources.length },
        { label: "Compute signals", value: compute },
        { label: "Database signals", value: database },
        { label: "Projects", value: new Set(resources.map((resource) => resource.projectId)).size },
      ]}
      tableTitle="Flexus resource rollup"
      title="Flexus"
    />
  );
}
