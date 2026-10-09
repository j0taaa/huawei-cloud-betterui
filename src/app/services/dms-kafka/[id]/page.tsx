import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Cable,
  Clock,
  HardDrive,
  MessageSquareMore,
  Network,
  Server,
  Shield,
  Tags,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsolePanel,
  ConsolePanelGrid,
  DataFreshnessText,
  FactGrid,
  FieldGrid,
  KeyValueGrid,
  ResourceDetailHero,
  StatusBadge,
  StringListPanel,
  UsageMeter,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { DmsKafkaInstanceActions } from "@/components/dms-kafka-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getDmsKafkaInstance, withCloudResult } from "@/lib/huawei-cloud";
import type { DmsKafkaInstanceDetails } from "@/lib/huawei-cloud";

function storagePercent(instance: DmsKafkaInstanceDetails) {
  const used = instance.usedStorageGb;
  const total = Number(instance.storage.match(/[\d.]+/)?.[0] ?? 0);

  return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
}

export default async function DmsKafkaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult<DmsKafkaInstanceDetails | null>(
    null,
    (session) => getDmsKafkaInstance(session, id),
    `dms-kafka-instance:${id}`,
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/dms-kafka"
        error={result.error}
      />
    );
  const instance = result.data;

  if (!instance) notFound();

  const percent = storagePercent(instance);
  const freshness = (
    <DataFreshnessText
      isCached={result.isCached}
      updatedAt={result.updatedAt}
    />
  );

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={
            <>
              <DmsKafkaInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/dms-kafka"
          backLabel="Back to DMS Kafka"
          description={freshness}
          eyebrow="DMS Kafka instance"
          icon={MessageSquareMore}
          id={instance.id}
          title={instance.name}
        />

        <FactGrid
          items={[
            {
              label: "Status",
              value: <StatusBadge status={instance.status} />,
            },
            { label: "Engine", value: `Kafka ${instance.engineVersion}` },
            {
              label: "Brokers",
              value: `${instance.brokerCount || "-"} brokers`,
            },
            { label: "Storage", value: instance.storage },
          ]}
        />

        <ConsolePanelGrid>
          <ConsolePanel
            description="Private, SSL, public, and Kafka Manager access points."
            icon={Cable}
            title="Connection"
          >
            <FieldGrid
              items={[
                { label: "Connection address", value: instance.connectAddress },
                {
                  label: "Private endpoint",
                  value: instance.privateConnectAddress,
                },
                { label: "SSL endpoint", value: instance.sslConnectAddress },
                {
                  label: "Public endpoint",
                  value: instance.publicConnectAddress,
                },
                {
                  label: "Kafka Manager enabled",
                  value: instance.kafkaManagerEnabled,
                },
                {
                  label: "Kafka Manager address",
                  value: instance.kafkaManagerAddress,
                },
                {
                  label: "Kafka Manager user",
                  value: instance.kafkaManagerUser,
                },
                { label: "Access user", value: instance.accessUser },
              ]}
            />
          </ConsolePanel>

          <ConsolePanel
            description="VPC placement, subnet, security group, and public IP binding."
            icon={Network}
            title="Network"
          >
            <FieldGrid
              items={[
                {
                  label: "VPC",
                  value: `${instance.vpcName} / ${instance.vpcId}`,
                },
                {
                  label: "Subnet",
                  value: `${instance.subnetName} / ${instance.subnetId}`,
                },
                { label: "Subnet CIDR", value: instance.subnetCidr },
                {
                  label: "Security group",
                  value: `${instance.securityGroupName} / ${instance.securityGroupId}`,
                },
                { label: "Public IP", value: instance.publicIpAddress },
                { label: "Public IP ID", value: instance.publicIpId },
                {
                  label: "Availability zones",
                  value: instance.availabilityZones.join(", ") || "-",
                },
                {
                  label: "Project",
                  value: `${instance.projectName} / ${instance.region}`,
                },
              ]}
            />
          </ConsolePanel>
        </ConsolePanelGrid>

        <ConsolePanelGrid>
          <ConsolePanel
            description="Broker footprint, partition scale, and storage pressure."
            icon={HardDrive}
            title="Capacity"
          >
            <UsageMeter percent={percent}>
              <FieldGrid
                items={[
                  {
                    label: "Used storage",
                    value: `${instance.usedStorage} (${percent}%)`,
                  },
                  { label: "Total storage", value: instance.storage },
                  { label: "Storage spec", value: instance.storageSpecCode },
                  { label: "Storage type", value: instance.storageType },
                  {
                    label: "Storage resource",
                    value: instance.storageResourceId,
                  },
                  { label: "Resource spec", value: instance.resourceSpecCode },
                  { label: "Partitions", value: instance.partitionNum || "-" },
                  { label: "Topics", value: instance.topicCount || "-" },
                ]}
              />
            </UsageMeter>
          </ConsolePanel>

          <ConsolePanel
            description="Broker addresses returned by the Kafka instance API."
            icon={Server}
            title="Broker IPs"
          >
            <StringListPanel
              emptyState="No broker IPs were returned."
              items={instance.brokerIps}
            />
          </ConsolePanel>
        </ConsolePanelGrid>

        <ConsolePanelGrid>
          <ConsolePanel
            description="Access controls, maintenance, billing, and enterprise project data."
            icon={Shield}
            title="Operations"
          >
            <FieldGrid
              items={[
                { label: "SSL enabled", value: instance.sslEnabled },
                { label: "Retention policy", value: instance.retentionPolicy },
                {
                  label: "Maintenance window",
                  value: instance.maintenanceWindow,
                },
                {
                  label: "Billing mode",
                  value: instance.billingMode || instance.chargingMode,
                },
                { label: "Architecture", value: instance.archType },
                { label: "Replica count", value: instance.replicaCount || "-" },
                {
                  label: "Enterprise project",
                  value: `${instance.enterpriseProjectName} / ${instance.enterpriseProjectId}`,
                },
                { label: "Description", value: instance.description },
              ]}
            />
          </ConsolePanel>

          <ConsolePanel
            description="Lifecycle dates and current service placement."
            icon={Clock}
            title="Lifecycle"
          >
            <FieldGrid
              items={[
                {
                  label: "Created",
                  value: <LocalDateTime value={instance.createdAt} />,
                },
                { label: "Region", value: instance.region },
                { label: "Project ID", value: instance.projectId },
                { label: "Instance ID", value: instance.id },
              ]}
            />
          </ConsolePanel>
        </ConsolePanelGrid>

        <ConsolePanelGrid>
          <ConsolePanel
            description="Console feature flags exposed by DMS Kafka."
            icon={Tags}
            title="Features"
          >
            <StringListPanel
              emptyState="No support feature flags were returned."
              items={instance.supportFeatures}
            />
          </ConsolePanel>
          <ConsolePanel
            description="User-defined resource tags."
            icon={Tags}
            title="Tags"
          >
            <KeyValueGrid
              emptyState="No tags were returned."
              items={instance.tags}
            />
          </ConsolePanel>
        </ConsolePanelGrid>
      </ConsoleMain>
    </ConsoleShell>
  );
}
