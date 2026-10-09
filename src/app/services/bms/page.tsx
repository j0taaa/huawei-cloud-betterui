import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Server } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listBmsServers, type BmsServer, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "BMS | Huawei Cloud Better UI" };

function serverTone(status: string) {
  const normalized = status.toUpperCase();

  if (normalized === "ACTIVE") {
    return "good";
  }

  if (["BUILD", "REBUILD", "SHUTOFF", "STOPPED"].includes(normalized)) {
    return "warn";
  }

  return normalized.includes("ERROR") ? "bad" : "neutral";
}

export default async function BmsPage() {
  const result = await withCloudResult<BmsServer[]>([], listBmsServers, cloudCacheKeys.listBmsServers);
  const servers = result.data;
  const active = servers.filter((server) => serverTone(server.status) === "good").length;
  const publicServers = servers.filter((server) => server.publicIp !== "-").length;

  return (
    <ServiceInventoryPage
      managementService="bms"
      actionLabel="Create BMS"
      actionTitle="BMS provisioning is intentionally disabled in this read-only view."
      active="Compute"
      backHref="/services/compute"
      backLabel="Back to Compute"
      columns={[
        { header: "Server", render: (server) => <span className="font-black">{server.name}</span> },
        {
          header: "Status",
          render: (server) => <InventoryStatus tone={serverTone(server.status)}>{server.status}</InventoryStatus>,
        },
        { header: "Flavor", render: (server) => server.flavor },
        { header: "Image", render: (server) => server.image },
        { header: "Private IP", render: (server) => server.privateIp },
        { header: "Public IP", render: (server) => server.publicIp },
        { header: "AZ", render: (server) => server.availabilityZone },
        { header: "Scope", render: (server) => `${server.projectName} / ${server.region}` },
      ]}
      description="Bare metal server fleet view with physical server status, image, flavor, AZ, and network reachability."
      empty="No bare metal servers found."
      icon={Server}
      result={result}
      rows={servers}
      stats={[
        { label: "Servers", value: servers.length },
        { label: "Active", value: active, tone: active === servers.length ? "good" : "warn" },
        { label: "Public IPs", value: publicServers, tone: publicServers ? "warn" : "neutral" },
        { label: "AZs", value: new Set(servers.map((item) => item.availabilityZone).filter((item) => item !== "-")).size },
      ]}
      tableTitle="Bare metal servers"
      title="Bare Metal Server"
    />
  );
}
