import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Network } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listVpcEndpoints, type VpcEndpoint, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "VPC Endpoint | Huawei Cloud Better UI" };

function endpointTone(status: string) {
  const normalized = status.toLowerCase();

  if (["accepted", "available", "active"].includes(normalized)) {
    return "good";
  }

  if (["creating", "pending", "rejected"].some((value) => normalized.includes(value))) {
    return "warn";
  }

  return normalized.includes("failed") ? "bad" : "neutral";
}

export default async function VpcEndpointPage() {
  const result = await withCloudResult<VpcEndpoint[]>([], listVpcEndpoints, cloudCacheKeys.listVpcEndpoints);
  const endpoints = result.data;
  const healthy = endpoints.filter((endpoint) => endpointTone(endpoint.status) === "good").length;
  const dnsEnabled = endpoints.filter((endpoint) => endpoint.dnsEnabled === "true").length;

  return (
    <ServiceInventoryPage
      actionLabel="Create endpoint"
      actionTitle="VPC endpoint creation is intentionally disabled in this read-only view."
      active="Networking"
      backHref="/services/networking"
      backLabel="Back to Networking"
      columns={[
        { header: "Endpoint", render: (endpoint) => <span className="font-black">{endpoint.id}</span> },
        {
          header: "Status",
          render: (endpoint) => <InventoryStatus tone={endpointTone(endpoint.status)}>{endpoint.status}</InventoryStatus>,
        },
        { header: "Service", render: (endpoint) => endpoint.endpointServiceName },
        { header: "Type", render: (endpoint) => endpoint.serviceType },
        { header: "Private IP", render: (endpoint) => endpoint.ip },
        { header: "DNS", render: (endpoint) => endpoint.dnsEnabled },
        { header: "VPC / Subnet", render: (endpoint) => `${endpoint.vpcId} / ${endpoint.subnetId}` },
        { header: "Scope", render: (endpoint) => `${endpoint.projectName} / ${endpoint.region}` },
      ]}
      description="Private service endpoints with accepted state, VPC placement, private IPs, and private DNS posture."
      empty="No VPC endpoints found."
      icon={Network}
      result={result}
      rows={endpoints}
      stats={[
        { label: "Endpoints", value: endpoints.length },
        { label: "Accepted", value: healthy, tone: healthy === endpoints.length ? "good" : "warn" },
        { label: "DNS enabled", value: dnsEnabled },
        { label: "VPCs", value: new Set(endpoints.map((item) => item.vpcId).filter((item) => item !== "-")).size },
      ]}
      tableTitle="Private endpoints"
      title="VPC Endpoint"
    />
  );
}
