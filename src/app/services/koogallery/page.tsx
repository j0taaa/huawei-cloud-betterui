import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Store } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import {
  listKooGalleryPurchasedApis,
  type KooGalleryPurchasedApi,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "KooGallery | Huawei Cloud Better UI",
};

const columns: InventoryColumn<KooGalleryPurchasedApi>[] = [
  {
    header: "Purchased API",
    render: (api) => (
      <ResourceIdentity description={api.remark} id={api.id} name={api.apiName} />
    ),
  },
  { header: "Status", render: (api) => <InventoryStatus>{api.status}</InventoryStatus> },
  { header: "API group", render: (api) => api.groupName },
  { header: "Environment", render: (api) => api.runEnvName },
  { header: "Project", render: (api) => api.projectName },
  { header: "Region", render: (api) => api.region },
];

export default async function KooGalleryPage() {
  const result = await withCloudResult<KooGalleryPurchasedApi[]>([], listKooGalleryPurchasedApis, cloudCacheKeys.listKooGalleryPurchasedApis);
  const apis = result.data;

  return (
    <ServiceInventoryPage
      actionLabel="Open marketplace"
      actionTitle="Marketplace purchase actions are disabled in this read-only view."
      active="Billing"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Documented read-only KooGallery rollup from APIG purchased API subscriptions; no marketplace order mutation is performed."
      empty="No KooGallery purchased APIs were returned by APIG subscription inventory."
      icon={Store}
      result={result}
      rows={apis}
      stats={[
        { label: "Purchased APIs", value: apis.length },
        { label: "API groups", value: new Set(apis.map((api) => api.groupName).filter((group) => group !== "-")).size },
        { label: "Environments", value: new Set(apis.map((api) => api.runEnvName).filter((env) => env !== "-")).size },
        { label: "Projects", value: new Set(apis.map((api) => api.projectId)).size },
      ]}
      tableTitle="KooGallery purchased API rollup"
      title="KooGallery"
    />
  );
}
