import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Rocket } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import {
  listCodeArtsDeployApplications,
  type CodeArtsDeployApplication,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CodeArts Deploy | Huawei Cloud Better UI",
};

const columns: InventoryColumn<CodeArtsDeployApplication>[] = [
  {
    header: "Application",
    render: (application) => (
      <ResourceIdentity description={application.description} id={application.id} name={application.name} />
    ),
  },
  { header: "Status", render: (application) => <InventoryStatus>{application.status}</InventoryStatus> },
  { header: "Group", render: (application) => application.groupName },
  { header: "Creator", render: (application) => application.creator },
  { header: "Created", render: (application) => application.createdAt },
  { header: "Updated", render: (application) => application.updatedAt },
  { header: "Project", render: (application) => application.projectName },
];

export default async function CodeArtsDeployPage() {
  const result = await withCloudResult<CodeArtsDeployApplication[]>([], listCodeArtsDeployApplications, cloudCacheKeys.listCodeArtsDeployApplications);
  const applications = result.data;
  const groups = new Set(applications.map((application) => application.groupName).filter((group) => group !== "-"));
  const creators = new Set(applications.map((application) => application.creator).filter((creator) => creator !== "-"));

  return (
    <ServiceInventoryPage
      managementService="codearts-deploy"
      actionLabel="Create app"
      actionTitle="Deploy application creation is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Deployment applications, ownership, grouping, and lifecycle timestamps from CodeArts Deploy."
      empty="No CodeArts Deploy applications were returned for the selected projects."
      icon={Rocket}
      result={result}
      rows={applications}
      stats={[
        { label: "Applications", value: applications.length },
        { label: "Groups", value: groups.size },
        { label: "Creators", value: creators.size },
        { label: "Projects", value: new Set(applications.map((application) => application.projectId)).size },
      ]}
      tableTitle="Deploy application inventory"
      title="CodeArts Deploy"
    />
  );
}
