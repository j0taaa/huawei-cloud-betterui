import type { Metadata } from "next";
import { Activity } from "lucide-react";
import {
  InventoryStatus,
  inventoryStatusTone,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import {
  listAomPrometheusInstances,
  type AomPrometheusInstance,
  withCloudResult,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
export const metadata: Metadata = { title: "AOM | Huawei Cloud Better UI" };
const columns: InventoryColumn<AomPrometheusInstance>[] = [
  {
    header: "Prometheus instance",
    render: (item) => <ResourceIdentity name={item.name} id={item.id} />,
  },
  {
    header: "Status",
    render: (item) => (
      <InventoryStatus tone={inventoryStatusTone(item.status)}>
        {item.status}
      </InventoryStatus>
    ),
  },
  { header: "Type", render: (item) => item.type },
  { header: "Version", render: (item) => item.version },
  {
    header: "Retention",
    render: (item) => (item.retention === "-" ? "—" : `${item.retention} days`),
  },
  { header: "Enterprise project", render: (item) => item.enterpriseProjectId },
  {
    header: "Project / region",
    render: (item) => `${item.projectName} / ${item.region}`,
  },
];
export default async function AomPage() {
  const result = await withCloudResult(
    [],
    listAomPrometheusInstances,
    cloudCacheKeys.listAomPrometheusInstances,
  );
  return (
    <ServiceInventoryPage
      active="Monitoring"
      backHref="/services/monitoring"
      backLabel="Back to monitoring"
      title="Application Operations Management"
      icon={Activity}
      description="Prometheus monitoring instances, source types, metric retention, and enterprise-project ownership."
      result={result}
      rows={result.data}
      rowKey={(item) => `${item.projectId}:${item.id}`}
      columns={columns}
      tableTitle="Prometheus instances"
      empty="No Prometheus instances were returned for the selected projects."
      stats={[
        { label: "Instances", value: result.data.length },
        {
          label: "Normal",
          value: result.data.filter((item) => item.status === "NORMAL").length,
          tone: "good",
        },
        {
          label: "Source types",
          value: new Set(
            result.data.map((item) => item.type).filter((type) => type !== "-"),
          ).size,
        },
        {
          label: "Projects",
          value: new Set(result.data.map((item) => item.projectId)).size,
        },
      ]}
    />
  );
}
