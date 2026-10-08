import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { listSecMasterWorkspaces, type SecMasterWorkspace, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SecMaster | Huawei Cloud Better UI",
};

export default async function SecMasterPage() {
  const result = await withCloudResult<SecMasterWorkspace[]>([], listSecMasterWorkspaces, cloudCacheKeys.listSecMasterWorkspaces);
  const workspaces = result.data;
  const views = workspaces.filter((workspace) => workspace.isView).length;
  const enterpriseScoped = workspaces.filter((workspace) => workspace.enterpriseProjectName !== "-").length;
  const regions = new Set(workspaces.map((workspace) => workspace.regionId).filter(Boolean));

  return (
    <ServiceInventoryPage
      actionLabel="Create workspace"
      actionTitle="Workspace creation is disabled in this read-only view."
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="SecMaster workspaces, view bindings, enterprise project scope, regional placement, and ownership metadata."
      empty="No SecMaster workspaces were returned for the selected projects."
      icon={ShieldCheck}
      result={result}
      rows={workspaces}
      stats={[
        { label: "Workspaces", value: workspaces.length },
        { label: "Views", value: views },
        { label: "Enterprise scoped", value: enterpriseScoped },
        { label: "Regions", value: regions.size },
      ]}
      tableTitle="Security Workspaces"
      title="SecMaster"
      tone="red"
      columns={[
        {
          header: "Workspace",
          render: (workspace) => (
            <div>
              <p className="font-black">{workspace.name}</p>
              <p className="mt-1 break-all text-xs text-[#98a2b3]">{workspace.id}</p>
            </div>
          ),
        },
        {
          header: "Mode",
          render: (workspace) => (
            <InventoryStatus tone={workspace.isView ? "warn" : "good"}>
              {workspace.isView ? "View" : "Workspace"}
            </InventoryStatus>
          ),
        },
        { header: "Description", render: (workspace) => workspace.description || "-" },
        { header: "Enterprise project", render: (workspace) => workspace.enterpriseProjectName },
        { header: "Owner", render: (workspace) => workspace.creatorName },
        { header: "Updated", render: (workspace) => workspace.updatedAt || workspace.createdAt || "-" },
        { header: "Project", render: (workspace) => `${workspace.projectName} · ${workspace.regionId}` },
      ]}
    />
  );
}
