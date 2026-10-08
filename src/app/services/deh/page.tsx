import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Server } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listDedicatedHosts, type DedicatedHost, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "DeH | Huawei Cloud Better UI" };

function hostTone(status: string) {
  const normalized = status.toLowerCase();

  if (["available", "normal"].includes(normalized)) {
    return "good";
  }

  if (["creating", "released", "freezed"].includes(normalized)) {
    return "warn";
  }

  return normalized.includes("fault") || normalized.includes("error") ? "bad" : "neutral";
}

export default async function DehPage() {
  const result = await withCloudResult<DedicatedHost[]>([], listDedicatedHosts, cloudCacheKeys.listDedicatedHosts);
  const hosts = result.data;
  const available = hosts.filter((host) => hostTone(host.status) === "good").length;
  const occupied = hosts.reduce((total, host) => total + host.instanceCount, 0);

  return (
    <ServiceInventoryPage
      actionLabel="Allocate DeH"
      actionTitle="Dedicated host allocation is intentionally disabled in this read-only view."
      active="Compute"
      backHref="/services/compute"
      backLabel="Back to Compute"
      columns={[
        { header: "Host", render: (host) => <span className="font-black">{host.name}</span> },
        {
          header: "State",
          render: (host) => <InventoryStatus tone={hostTone(host.status)}>{host.status}</InventoryStatus>,
        },
        { header: "Type", render: (host) => host.hostType },
        { header: "AZ", render: (host) => host.availabilityZone },
        { header: "vCPUs", render: (host) => `${host.availableVcpus} available / ${host.totalVcpus} total` },
        { header: "Memory", render: (host) => `${host.availableMemory} available / ${host.totalMemory} total` },
        { header: "ECS count", render: (host) => host.instanceCount },
        { header: "Scope", render: (host) => `${host.projectName} / ${host.region}` },
      ]}
      description="Dedicated host capacity view for placement, occupancy, available vCPUs, memory, and isolation posture."
      empty="No dedicated hosts found."
      icon={Server}
      result={result}
      rows={hosts}
      stats={[
        { label: "Hosts", value: hosts.length },
        { label: "Available", value: available, tone: available === hosts.length ? "good" : "warn" },
        { label: "Placed ECS", value: occupied },
        { label: "Host types", value: new Set(hosts.map((item) => item.hostType).filter((item) => item !== "-")).size },
      ]}
      tableTitle="Dedicated host capacity"
      title="Dedicated Host"
    />
  );
}
