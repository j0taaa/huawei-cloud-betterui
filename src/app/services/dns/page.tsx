import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Network } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listDnsZones, type DnsZone, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "DNS | Huawei Cloud Better UI" };

export default async function DnsPage() {
  const result = await withCloudResult<DnsZone[]>([], listDnsZones, cloudCacheKeys.listDnsZones);
  const zones = result.data;
  const active = zones.filter((zone) => zone.status.toLowerCase() === "active").length;

  return (
    <ServiceInventoryPage
      actionLabel="Create zone"
      actionTitle="Zone creation is intentionally disabled in this read-only view."
      active="Networking"
      backHref="/services/networking"
      backLabel="Back to Networking"
      columns={[
        { header: "Zone", render: (zone) => <span className="font-black">{zone.name}</span> },
        { header: "Status", render: (zone) => <InventoryStatus tone={zone.status.toLowerCase() === "active" ? "good" : "warn"}>{zone.status}</InventoryStatus> },
        { header: "Type", render: (zone) => zone.type },
        { header: "Records", render: (zone) => zone.recordCount },
        { header: "TTL", render: (zone) => zone.ttl },
        { header: "Description", render: (zone) => zone.description || "-" },
      ]}
      description="Public DNS zones and record density for domain operations."
      empty="No DNS zones found."
      icon={Network}
      result={result}
      rows={zones}
      stats={[
        { label: "Zones", value: zones.length },
        { label: "Active", value: active, tone: active === zones.length ? "good" : "warn" },
        { label: "Records", value: zones.reduce((sum, zone) => sum + zone.recordCount, 0) },
        { label: "Public zones", value: zones.filter((zone) => zone.type === "public").length },
      ]}
      tableTitle="DNS zones"
      title="Domain Name Service"
    />
  );
}
