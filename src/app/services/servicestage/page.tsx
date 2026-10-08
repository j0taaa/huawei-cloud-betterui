import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Boxes } from "lucide-react";

import {
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import {
  listServiceStageApplications,
  type ServiceStageApplication,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "ServiceStage | Huawei Cloud Better UI",
};

const columns: InventoryColumn<ServiceStageApplication>[] = [
  {
    header: "Application",
    render: (application) => (
      <div>
        <p className="font-black">{application.name}</p>
        <p className="mt-1 break-all text-xs text-[#98a2b3]">{application.id}</p>
        {application.description ? <p className="mt-2 text-xs text-[#667085]">{application.description}</p> : null}
      </div>
    ),
  },
  { header: "Components", render: (application) => application.componentCount },
  { header: "Creator", render: (application) => application.creator },
  { header: "Enterprise project", render: (application) => application.enterpriseProjectId },
  { header: "Created", render: (application) => application.createdAt },
  { header: "Updated", render: (application) => application.updatedAt },
  { header: "Project", render: (application) => application.projectName },
];

export default async function ServiceStagePage() {
  const result = await withCloudResult<ServiceStageApplication[]>([], listServiceStageApplications, cloudCacheKeys.listServiceStageApplications);
  const applications = result.data;
  const components = applications.reduce((total, application) => total + application.componentCount, 0);

  return (
    <ServiceInventoryPage
      actionLabel="Create app"
      actionTitle="ServiceStage application creation is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="ServiceStage applications with component counts, creators, enterprise project scope, and lifecycle timestamps."
      empty="No ServiceStage applications were returned for the selected projects."
      icon={Boxes}
      result={result}
      rows={applications}
      stats={[
        { label: "Applications", value: applications.length },
        { label: "Components", value: components },
        { label: "Creators", value: new Set(applications.map((application) => application.creator).filter((creator) => creator !== "-")).size },
        { label: "Enterprise projects", value: new Set(applications.map((application) => application.enterpriseProjectId).filter((id) => id !== "-")).size },
      ]}
      tableTitle="Application inventory"
      title="ServiceStage"
    />
  );
}
