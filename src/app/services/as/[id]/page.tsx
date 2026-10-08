import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Scaling } from "lucide-react";
import { CloudErrorPage } from "@/components/cloud-error";
import { LocalDateTime } from "@/components/local-date-time";
import {
  getAsGroup,
  withCloudResult,
  type AsGroupDetail,
  type AsInstance,
  type AsPolicy,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import {
  InventoryStatus,
  InventoryTable,
  ResourceFacts,
  ServiceInventoryPage,
  type InventoryColumn,
} from "../../_components/service-inventory";

export const metadata: Metadata = {
  title: "Scaling group | Huawei Cloud Better UI",
};
const policyColumns: InventoryColumn<AsPolicy>[] = [
  { header: "Policy", render: (policy) => policy.name },
  { header: "Type", render: (policy) => policy.type },
  {
    header: "Status",
    render: (policy) => (
      <InventoryStatus tone={policy.status === "INSERVICE" ? "good" : "warn"}>
        {policy.status}
      </InventoryStatus>
    ),
  },
  {
    header: "Action",
    render: (policy) =>
      `${policy.operation} ${policy.instanceNumber ?? (policy.instancePercentage == null ? "—" : `${policy.instancePercentage}%`)}`,
  },
  {
    header: "Schedule / Alarm",
    render: (policy) => policy.schedule || policy.alarmId || "—",
  },
  { header: "Cooldown", render: (policy) => `${policy.cooldown}s` },
];

export default async function ScalingGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult<AsGroupDetail | null>(
    null,
    (session) => getAsGroup(session, id),
    cloudCacheKeys.asGroup(id),
  );
  if (!result.data) {
    if (result.error)
      return (
        <CloudErrorPage
          active="Compute"
          backHref="/services/as"
          error={result.error}
        />
      );
    notFound();
  }
  const { group, instances, policies, configuration } = result.data;
  const instanceColumns: InventoryColumn<AsInstance>[] = [
    {
      header: "Instance",
      render: (instance) => (
        <Link
          className="font-black text-[#2563eb]"
          href={`/services/ecs/${encodeURIComponent(instance.id)}`}
        >
          {instance.name}
        </Link>
      ),
    },
    { header: "Lifecycle", render: (instance) => instance.lifecycle },
    {
      header: "Health",
      render: (instance) => (
        <InventoryStatus
          tone={
            instance.health === "NORMAL"
              ? "good"
              : instance.health === "ERROR"
                ? "bad"
                : "warn"
          }
        >
          {instance.health}
        </InventoryStatus>
      ),
    },
    {
      header: "Protected from scale-in",
      render: (instance) => (instance.protected ? "Yes" : "No"),
    },
    {
      header: "Configuration",
      render: (instance) => instance.configurationName,
    },
    {
      header: "Added",
      render: (instance) => <LocalDateTime value={instance.createdAt} />,
    },
  ];
  return (
    <ServiceInventoryPage
      active="Compute"
      backHref="/services/as"
      backLabel="Back to Auto Scaling"
      icon={Scaling}
      title={group.name}
      description={`${group.id} · ${group.projectName} · ${group.region}${group.description ? ` · ${group.description}` : ""}`}
      result={result}
      rows={instances}
      rowKey={(instance) => instance.id}
      columns={instanceColumns}
      tableTitle="Member instances"
      empty="No instances in this group."
      stats={[
        { label: "Status", value: group.status },
        {
          label: "Current / Desired",
          value: `${group.current} / ${group.desired}`,
        },
        {
          label: "Minimum / Maximum",
          value: `${group.minimum} / ${group.maximum}`,
        },
        { label: "Scaling policies", value: policies.length },
      ]}
    >
      <ResourceFacts
        items={[
          { label: "VPC", value: group.vpcId },
          { label: "Subnets", value: group.subnetIds.join(", ") },
          {
            label: "Availability zones",
            value: group.availabilityZones.join(", "),
          },
          { label: "Health check", value: group.healthCheck },
          { label: "Cooldown", value: `${group.cooldown}s` },
          {
            label: "Configuration",
            value: configuration?.name ?? group.configurationName,
          },
          { label: "Flavor", value: configuration?.flavor },
          { label: "Image", value: configuration?.imageId },
          { label: "SSH key", value: configuration?.keyName },
          {
            label: "Disks",
            value: configuration?.disks
              .map((disk) => `${disk.type}: ${disk.size} GB ${disk.volumeType}`)
              .join(" · "),
          },
        ]}
      />
      <InventoryTable
        rows={policies}
        rowKey={(policy) => policy.id}
        columns={policyColumns}
        title="Scaling policies"
        empty={
          result.error
            ? "Policy data may be unavailable. Try refreshing."
            : "No scaling policies found."
        }
      />
    </ServiceInventoryPage>
  );
}
