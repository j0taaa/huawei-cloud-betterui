import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Waypoints } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listApigInstances, type ApigInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "APIG | Huawei Cloud Better UI" };

export default async function ApigPage() {
  const result = await withCloudResult<ApigInstance[]>([], listApigInstances, cloudCacheKeys.listApigInstances);
  const instances = result.data;
  const running = instances.filter((item) => item.status.toLowerCase().includes("running") || item.status.toLowerCase() === "available").length;

  return (
    <ServiceInventoryPage
      managementService="apig"
      actionLabel="Create gateway"
      actionTitle="APIG instance creation is intentionally disabled in this read-only view."
      active="Networking"
      backHref="/services/networking"
      backLabel="Back to Networking"
      columns={[
        { header: "Instance", render: (item) => <span className="font-black">{item.name}</span> },
        { header: "Status", render: (item) => <InventoryStatus tone={item.status.toLowerCase().includes("running") ? "good" : "warn"}>{item.status}</InventoryStatus> },
        { header: "Edition", render: (item) => item.edition },
        { header: "EIP", render: (item) => item.eipAddress },
        { header: "VPC / Subnet", render: (item) => `${item.vpcId} / ${item.subnetId}` },
        { header: "Project", render: (item) => `${item.projectName} · ${item.region}` },
      ]}
      description="Dedicated API Gateway instances with network attachment and edition context."
      empty="No APIG dedicated instances found."
      icon={Waypoints}
      result={result}
      rows={instances}
      stats={[
        { label: "Instances", value: instances.length },
        { label: "Running", value: running, tone: running === instances.length ? "good" : "warn" },
        { label: "With EIP", value: instances.filter((item) => item.eipAddress !== "-").length },
        { label: "Projects", value: new Set(instances.map((item) => item.projectId)).size },
      ]}
      tableTitle="API Gateway instances"
      title="API Gateway"
    />
  );
}
