import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ServerCog } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
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
      <ResourceIdentity id={resource.id} name={resource.name} />
    ),
  },
  { header: "Source", render: (resource) => <InventoryStatus>{resource.sourceService}</InventoryStatus> },
  { header: "Status", render: (resource) => <InventoryStatus>{resource.status}</InventoryStatus> },
  { header: "Product", render: (resource) => resource.signal },
  { header: "Private IP", render: (resource) => resource.privateIp },
  { header: "Public IP", render: (resource) => resource.publicIp },
  { header: "Project", render: (resource) => `${resource.projectName} / ${resource.region}` },
];

export default async function FlexusPage() {
  const result = await withCloudResult<FlexusResource[]>([], listFlexusResources, cloudCacheKeys.listFlexusResources);
  const resources = result.data;
  const lInstances = resources.filter((resource) => resource.signal === "L").length;
  const xInstances = resources.filter((resource) => resource.signal === "X").length;

  return (
    <ServiceInventoryPage
      managementService="flexus"
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Native Flexus L bundles and Flexus X servers, with verified identities and project scope. Management covers inspection, power actions, server metadata, and administrator password resets."
      empty="No native Flexus L or X resources were returned."
      icon={ServerCog}
      result={result}
      rows={resources}
      stats={[
        { label: "Flexus resources", value: resources.length },
        { label: "Flexus L bundles", value: lInstances },
        { label: "Flexus X servers", value: xInstances },
        { label: "Projects", value: new Set(resources.map((resource) => resource.projectId)).size },
      ]}
      tableTitle="Flexus resources"
      title="Flexus"
    />
  );
}
