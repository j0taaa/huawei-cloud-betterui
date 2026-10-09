import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Route } from "lucide-react";

import {
  InventoryStatus,
  inventoryStatusTone,
  ServiceInventoryPage,
} from "@/app/services/_components/service-inventory";
import {
  listEnterpriseRouters,
  type EnterpriseRouter,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "Enterprise Router | Huawei Cloud Better UI" };

export default async function EnterpriseRouterPage() {
  const result = await withCloudResult<EnterpriseRouter[]>([], listEnterpriseRouters, cloudCacheKeys.listEnterpriseRouters);
  const routers = result.data;
  const available = routers.filter((router) => inventoryStatusTone(router.status) === "good").length;
  const sharedAutoAccept = routers.filter(
    (router) => router.autoAcceptSharedAttachments === "true",
  ).length;

  return (
    <ServiceInventoryPage
      actionLabel="Create router"
      actionTitle="Enterprise Router creation is intentionally disabled in this read-only view."
      active="Networking"
      backHref="/services/networking"
      backLabel="Back to Networking"
      columns={[
        { header: "Router", render: (router) => <span className="font-black">{router.name}</span> },
        {
          header: "State",
          render: (router) => <InventoryStatus tone={inventoryStatusTone(router.status)}>{router.status}</InventoryStatus>,
        },
        { header: "ASN", render: (router) => router.asn },
        { header: "Default association", render: (router) => router.defaultAssociation },
        { header: "Default propagation", render: (router) => router.defaultPropagation },
        { header: "Route table", render: (router) => router.routeTableId },
        { header: "Auto accept shared", render: (router) => router.autoAcceptSharedAttachments },
        { header: "Scope", render: (router) => `${router.projectName} / ${router.region}` },
      ]}
      description="Cloud routing hubs with ASN, route-table defaults, propagation posture, and shared-attachment policy."
      empty="No enterprise routers found."
      icon={Route}
      result={result}
      rows={routers}
      stats={[
        { label: "Routers", value: routers.length },
        { label: "Available", value: available, tone: available === routers.length ? "good" : "warn" },
        { label: "Auto-accept shared", value: sharedAutoAccept, tone: sharedAutoAccept ? "warn" : "neutral" },
        { label: "ASNs", value: new Set(routers.map((item) => item.asn).filter((item) => item !== "-")).size },
      ]}
      tableTitle="Enterprise routers"
      title="Enterprise Router"
    />
  );
}
