import type { Metadata } from "next";
import { Rocket } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
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
      <div>
        <p className="font-black">{application.name}</p>
        <p className="mt-1 break-all text-xs text-[#98a2b3]">{application.id}</p>
        {application.description ? <p className="mt-2 text-xs text-[#667085]">{application.description}</p> : null}
      </div>
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
  const result = await withCloudResult<CodeArtsDeployApplication[]>([], listCodeArtsDeployApplications);
  const applications = result.data;
  const groups = new Set(applications.map((application) => application.groupName).filter((group) => group !== "-"));
  const creators = new Set(applications.map((application) => application.creator).filter((creator) => creator !== "-"));

  return (
    <ServiceInventoryPage
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
