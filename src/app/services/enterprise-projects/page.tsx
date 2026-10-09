import type { Metadata } from "next";
import { FolderTree } from "lucide-react";
import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listEnterpriseProjects,
  type EnterpriseProject,
  withCloudResult,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
export const metadata: Metadata = {
  title: "Enterprise Project Management | Huawei Cloud Better UI",
};
const columns: InventoryColumn<EnterpriseProject>[] = [
  {
    header: "Enterprise project",
    render: (item) => <ResourceIdentity name={item.name} id={item.id} />,
  },
  {
    header: "Status",
    render: (item) => (
      <InventoryStatus
        tone={
          item.status === "Enabled"
            ? "good"
            : item.status === "Disabled"
              ? "warn"
              : "neutral"
        }
      >
        {item.status}
      </InventoryStatus>
    ),
  },
  { header: "Type", render: (item) => item.type },
  { header: "Description", render: (item) => item.description },
  {
    header: "Created",
    render: (item) => <LocalDateTime value={item.createdAt} />,
  },
  {
    header: "Updated",
    render: (item) => <LocalDateTime value={item.updatedAt} />,
  },
];
export default async function EnterpriseProjectsPage() {
  const result = await withCloudResult(
    [],
    listEnterpriseProjects,
    cloudCacheKeys.listEnterpriseProjects,
  );
  return (
    <ServiceInventoryPage
      managementService="enterprise-projects"
      active="Billing"
      backHref="/services/billing"
      backLabel="Back to billing and governance"
      title="Enterprise Project Management"
      icon={FolderTree}
      description="Account-wide enterprise projects for grouping resources, separating environments, and organizing costs."
      result={result}
      rows={result.data}
      rowKey={(item) => item.id}
      columns={columns}
      tableTitle="Enterprise projects"
      empty="No enterprise projects were returned for this account."
      stats={[
        { label: "Enterprise projects", value: result.data.length },
        {
          label: "Enabled",
          value: result.data.filter((item) => item.status === "Enabled").length,
          tone: "good",
        },
        {
          label: "Disabled",
          value: result.data.filter((item) => item.status === "Disabled")
            .length,
        },
        {
          label: "Test projects",
          value: result.data.filter((item) => item.type === "Test").length,
        },
      ]}
    />
  );
}
