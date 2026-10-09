import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { listCloudFirewalls, type CloudFirewall, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CFW | Huawei Cloud Better UI",
};

function serviceTypeLabel(value: string) {
  if (value === "0") {
    return "North-south";
  }

  if (value === "1") {
    return "East-west";
  }

  return value;
}

export default async function CfwPage() {
  const result = await withCloudResult<CloudFirewall[]>([], listCloudFirewalls, cloudCacheKeys.listCloudFirewalls);
  const firewalls = result.data;
  const eipCapacity = firewalls.every(firewall => firewall.eipCount !== null) ? firewalls.reduce((total, firewall) => total + firewall.eipCount!, 0) : "Unknown";
  const vpcCapacity = firewalls.every(firewall => firewall.vpcCount !== null) ? firewalls.reduce((total, firewall) => total + firewall.vpcCount!, 0) : "Unknown";
  const eastWest = firewalls.filter((firewall) => firewall.serviceType === "1").length;

  return (
    <ServiceInventoryPage
      actionLabel="Create firewall"
      managementService="cfw"
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="Cloud Firewall instances, border type, HA posture, engine, protected EIP/VPC quotas, and enterprise project scope."
      empty="No Cloud Firewall instances were returned for the selected projects."
      icon={ShieldAlert}
      result={result}
      rows={firewalls}
      stats={[
        { label: "Firewalls", value: firewalls.length },
        { label: "EIP capacity", value: eipCapacity },
        { label: "VPC capacity", value: vpcCapacity },
        { label: "East-west", value: eastWest },
      ]}
      tableTitle="Firewall Instances"
      title="Cloud Firewall"
      tone="red"
      columns={[
        {
          header: "Firewall",
          render: (firewall) => (
            <ResourceIdentity id={firewall.id} name={firewall.name} />
          ),
        },
        {
          header: "Status",
          render: (firewall) => (
            <InventoryStatus tone={firewall.status === "2" ? "good" : "neutral"}>
              {firewall.status}
            </InventoryStatus>
          ),
        },
        { header: "Border", render: (firewall) => serviceTypeLabel(firewall.serviceType) },
        { header: "Capacity", render: (firewall) => `${firewall.eipCount ?? "Unknown"} EIPs · ${firewall.vpcCount ?? "Unknown"} VPCs` },
        { header: "Bandwidth", render: (firewall) => firewall.bandwidth },
        { header: "HA / engine", render: (firewall) => `HA ${firewall.haType} · engine ${firewall.engineType}` },
        { header: "Project", render: (firewall) => `${firewall.projectName} · ${firewall.enterpriseProjectId}` },
      ]}
    />
  );
}
