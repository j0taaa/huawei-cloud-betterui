import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
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
  const protectedEips = firewalls.reduce((total, firewall) => total + firewall.eipCount, 0);
  const protectedVpcs = firewalls.reduce((total, firewall) => total + firewall.vpcCount, 0);
  const eastWest = firewalls.filter((firewall) => firewall.serviceType === "1").length;

  return (
    <ServiceInventoryPage
      actionLabel="Create firewall"
      actionTitle="Firewall creation is disabled in this read-only view."
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
        { label: "Protected EIPs", value: protectedEips },
        { label: "Protected VPCs", value: protectedVpcs },
        { label: "East-west", value: eastWest },
      ]}
      tableTitle="Firewall Instances"
      title="Cloud Firewall"
      tone="red"
      columns={[
        {
          header: "Firewall",
          render: (firewall) => (
            <div>
              <p className="font-black">{firewall.name}</p>
              <p className="mt-1 break-all text-xs text-[#98a2b3]">{firewall.id}</p>
            </div>
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
        { header: "Capacity", render: (firewall) => `${firewall.eipCount} EIPs · ${firewall.vpcCount} VPCs` },
        { header: "Bandwidth", render: (firewall) => firewall.bandwidth },
        { header: "HA / engine", render: (firewall) => `HA ${firewall.haType} · engine ${firewall.engineType}` },
        { header: "Project", render: (firewall) => `${firewall.projectName} · ${firewall.enterpriseProjectId}` },
      ]}
    />
  );
}
