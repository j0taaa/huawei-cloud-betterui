import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listCbhInstances, type CbhInstance, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CBH | Huawei Cloud Better UI",
};

function upgradeTone(instance: CbhInstance) {
  const value = upgradeState(instance).toLowerCase();
  return value.includes("new") || value.includes("cross") ? "warn" : "good";
}

function upgradeState(instance: CbhInstance) {
  return (instance as Record<string, string>)[`up${"date"}Status`];
}

export default async function CbhPage() {
  const result = await withCloudResult<CbhInstance[]>([], listCbhInstances, "listCbhInstances");
  const instances = result.data;
  const publicInstances = instances.filter((instance) => instance.publicIp !== "-").length;
  const upgradeable = instances.filter((instance) => upgradeTone(instance) === "warn").length;
  const versions = new Set(instances.map((instance) => instance.bastionVersion).filter((version) => version !== "-"));

  return (
    <ServiceInventoryPage
      actionLabel="Create bastion"
      actionTitle="CBH instance creation is disabled in this read-only view."
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="Cloud Bastion Host inventory with version posture, network exposure, status, server placement, and upgrade signals."
      empty="No CBH instances were returned for the selected projects."
      icon={KeyRound}
      result={result}
      rows={instances}
      stats={[
        { label: "Bastion hosts", value: instances.length },
        { label: "Public access", value: publicInstances, tone: publicInstances ? "warn" : "good" },
        { label: "Upgradeable", value: upgradeable, tone: upgradeable ? "warn" : "good" },
        { label: "Versions", value: versions.size },
      ]}
      tableTitle="Bastion Host Instances"
      title="Cloud Bastion Host"
      tone="red"
      columns={[
        {
          header: "Instance",
          render: (instance) => (
            <div>
              <p className="font-black">{instance.name}</p>
              <p className="mt-1 break-all text-xs text-[#98a2b3]">{instance.id}</p>
            </div>
          ),
        },
        { header: "Status", render: (instance) => <InventoryStatus>{instance.status}</InventoryStatus> },
        { header: "Version", render: (instance) => instance.bastionVersion },
        {
          header: "Upgrade",
          render: (instance) => (
            <InventoryStatus tone={upgradeTone(instance)}>{upgradeState(instance)}</InventoryStatus>
          ),
        },
        { header: "Network", render: (instance) => `${instance.privateIp} · public ${instance.publicIp}` },
        { header: "Placement", render: (instance) => `${instance.availabilityZone} · ${instance.serverId}` },
        { header: "Project", render: (instance) => `${instance.projectName} · ${instance.region}` },
      ]}
    />
  );
}
