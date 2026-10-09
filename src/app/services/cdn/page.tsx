import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { RadioTower } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listCdnDomains, type CdnDomain, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "CDN | Huawei Cloud Better UI" };

export default async function CdnPage() {
  const result = await withCloudResult<CdnDomain[]>([], listCdnDomains, cloudCacheKeys.listCdnDomains);
  const domains = result.data;
  const enabled = domains.filter((domain) => domain.status.toLowerCase().includes("online") || domain.status.toLowerCase() === "enabled").length;

  return (
    <ServiceInventoryPage
      managementService="cdn"
      actionLabel="Add domain"
      actionTitle="CDN domain creation is intentionally disabled in this read-only view."
      active="Networking"
      backHref="/services/networking"
      backLabel="Back to Networking"
      columns={[
        { header: "Domain", render: (domain) => <span className="font-black">{domain.domainName}</span> },
        { header: "Status", render: (domain) => <InventoryStatus tone={domain.status.toLowerCase().includes("online") ? "good" : "warn"}>{domain.status}</InventoryStatus> },
        { header: "CNAME", render: (domain) => domain.cname },
        { header: "Business", render: (domain) => domain.businessType },
        { header: "Service Area", render: (domain) => domain.serviceArea },
        { header: "Origin", render: (domain) => domain.originHost },
      ]}
      description="Accelerated domains, CNAME targets, origins, and service area posture."
      empty="No CDN domains found."
      icon={RadioTower}
      result={result}
      rows={domains}
      stats={[
        { label: "Domains", value: domains.length },
        { label: "Online", value: enabled, tone: enabled === domains.length ? "good" : "warn" },
        { label: "Web domains", value: domains.filter((domain) => domain.businessType.toLowerCase().includes("web")).length },
        { label: "Service areas", value: new Set(domains.map((domain) => domain.serviceArea)).size },
      ]}
      tableTitle="CDN domains"
      title="Content Delivery Network"
    />
  );
}
