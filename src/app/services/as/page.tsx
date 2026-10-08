import type { Metadata } from "next";
import Link from "next/link";
import { Scaling } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listAsGroups,
  withCloudResult,
  type AsGroup,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "../_components/service-inventory";

export const metadata: Metadata = {
  title: "Auto Scaling | Huawei Cloud Better UI",
};
const columns: InventoryColumn<AsGroup>[] = [
  {
    header: "Group",
    render: (group) => (
      <>
        <Link
          className="font-black text-[#2563eb]"
          href={`/services/as/${encodeURIComponent(group.id)}`}
        >
          {group.name}
        </Link>
        <p className="mt-1 text-xs text-[#667085]">{group.id}</p>
      </>
    ),
  },
  {
    header: "Status",
    render: (group) => (
      <InventoryStatus
        tone={
          group.status === "INSERVICE"
            ? "good"
            : group.status === "ERROR"
              ? "bad"
              : "warn"
        }
      >
        {group.status}
        {group.isScaling ? " · Scaling" : ""}
      </InventoryStatus>
    ),
  },
  {
    header: "Capacity",
    render: (group) => (
      <>
        {group.current} current / {group.desired} desired
        <p className="mt-1 text-xs text-[#667085]">
          Min {group.minimum} · Max {group.maximum}
        </p>
      </>
    ),
  },
  { header: "Configuration", render: (group) => group.configurationName },
  {
    header: "Project / Region",
    render: (group) => (
      <>
        {group.projectName}
        <p className="mt-1 text-xs text-[#667085]">{group.region}</p>
      </>
    ),
  },
  {
    header: "Created",
    render: (group) => <LocalDateTime value={group.createdAt} />,
  },
];

export default async function AutoScalingPage() {
  const result = await withCloudResult<AsGroup[]>(
    [],
    listAsGroups,
    cloudCacheKeys.listAsGroups,
  );
  const groups = result.data;
  return (
    <ServiceInventoryPage
      active="Compute"
      backHref="/services/compute"
      backLabel="Back to compute"
      icon={Scaling}
      title="Auto Scaling"
      description="Scaling groups and capacity across your accessible projects. Open a group to inspect its instances, policies, and configuration."
      result={result}
      rows={groups}
      rowKey={(group) => `${group.projectId}:${group.id}`}
      columns={columns}
      tableTitle="Scaling groups"
      empty="No scaling groups found."
      stats={[
        { label: "Groups", value: groups.length },
        {
          label: "Current instances",
          value: groups.reduce((sum, group) => sum + group.current, 0),
        },
        {
          label: "Desired instances",
          value: groups.reduce((sum, group) => sum + group.desired, 0),
        },
        {
          label: "Scaling now",
          value: groups.filter((group) => group.isScaling).length,
        },
      ]}
    />
  );
}
