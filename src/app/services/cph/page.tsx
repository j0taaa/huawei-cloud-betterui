import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Smartphone } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { listCphServers, type CphServer, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CPH | Huawei Cloud Better UI",
};

export default async function CphPage() {
  const result = await withCloudResult<CphServer[]>([], listCphServers, cloudCacheKeys.listCphServers);
  const servers = result.data;
  const phones = servers.reduce((total, server) => total + server.phoneCount, 0);
  const publicServers = servers.filter((server) => server.publicIp !== "-").length;
  const flavors = new Set(servers.map((server) => server.flavor).filter((flavor) => flavor !== "-"));

  return (
    <ServiceInventoryPage
      managementService="cph"
      actionLabel="Buy server"
      actionTitle="Cloud phone server purchases are disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to Services"
      description="Cloud Phone Host server inventory with phone capacity, flavor, public access, VPC placement, bandwidth, and AZ."
      empty="No CPH cloud phone servers were returned for the selected projects."
      icon={Smartphone}
      result={result}
      rows={servers}
      stats={[
        { label: "Servers", value: servers.length },
        { label: "Cloud phones", value: phones },
        { label: "Public servers", value: publicServers, tone: publicServers ? "warn" : "good" },
        { label: "Flavors", value: flavors.size },
      ]}
      tableTitle="Cloud Phone Servers"
      title="Cloud Phone Host"
      tone="blue"
      columns={[
        {
          header: "Server",
          render: (server) => (
            <ResourceIdentity id={server.id} name={server.name} />
          ),
        },
        { header: "Status", render: (server) => <InventoryStatus>{server.status}</InventoryStatus> },
        { header: "Capacity", render: (server) => `${server.phoneCount} phones · ${server.flavor}` },
        { header: "Network", render: (server) => `${server.vpcId} · ${server.subnetId}` },
        { header: "Public IP", render: (server) => server.publicIp },
        { header: "Bandwidth", render: (server) => server.bandwidth },
        { header: "Project", render: (server) => `${server.projectName} · ${server.availabilityZone}` },
      ]}
    />
  );
}
