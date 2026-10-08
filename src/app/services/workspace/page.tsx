import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Monitor } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listWorkspaceTenants, type WorkspaceTenant, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "Workspace | Huawei Cloud Better UI",
};

function accessTone(tenant: WorkspaceTenant) {
  return tenant.accessMode.toLowerCase().includes("internet") ? "warn" : "good";
}

export default async function WorkspacePage() {
  const result = await withCloudResult<WorkspaceTenant[]>([], listWorkspaceTenants, cloudCacheKeys.listWorkspaceTenants);
  const tenants = result.data;
  const subscribed = tenants.filter((tenant) => tenant.status.toLowerCase().includes("subscribed")).length;
  const internetAccess = tenants.filter((tenant) => tenant.accessMode.toLowerCase().includes("internet")).length;
  const subnets = tenants.reduce((total, tenant) => total + tenant.subnetCount, 0);

  return (
    <ServiceInventoryPage
      actionLabel="Subscribe workspace"
      actionTitle="Workspace subscription changes are disabled in this read-only view."
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="Huawei Cloud Workspace tenant state, access mode, VPC placement, service subnets, security group, and enterprise ID."
      empty="No Workspace tenant details were returned for the selected projects."
      icon={Monitor}
      result={result}
      rows={tenants}
      stats={[
        { label: "Tenant records", value: tenants.length },
        { label: "Subscribed", value: subscribed },
        { label: "Internet access", value: internetAccess, tone: internetAccess ? "warn" : "good" },
        { label: "Service subnets", value: subnets },
      ]}
      tableTitle="Workspace Tenant Configuration"
      title="Workspace"
      tone="red"
      columns={[
        {
          header: "Enterprise",
          render: (tenant) => (
            <div>
              <p className="font-black">{tenant.enterpriseId}</p>
              <p className="mt-1 break-all text-xs text-[#98a2b3]">{tenant.id}</p>
            </div>
          ),
        },
        { header: "Status", render: (tenant) => <InventoryStatus>{tenant.status}</InventoryStatus> },
        {
          header: "Access",
          render: (tenant) => (
            <InventoryStatus tone={accessTone(tenant)}>{tenant.accessMode}</InventoryStatus>
          ),
        },
        { header: "VPC", render: (tenant) => `${tenant.vpcName} · ${tenant.vpcId}` },
        { header: "Subnets", render: (tenant) => `${tenant.subnetCount} service · mgmt ${tenant.managementSubnetCidr}` },
        { header: "Security group", render: (tenant) => tenant.desktopSecurityGroup },
        { header: "Project", render: (tenant) => `${tenant.projectName} · ${tenant.region}` },
      ]}
    />
  );
}
