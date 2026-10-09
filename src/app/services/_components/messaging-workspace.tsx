import { MessageSquareMore } from "lucide-react";
import { CloudErrorBanner, CloudErrorPage } from "@/components/cloud-error";
import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import {
  ConsoleMain,
  ConsolePanel,
  DataFreshnessText,
  FieldGrid,
  ResourceDetailHero,
  ResourceIdentity,
} from "@/components/console-ui";
import type { CloudResult } from "@/lib/huawei/result";
import type {
  MessagingEngine,
  MessagingInstance,
} from "@/lib/huawei/messaging";
import {
  InventoryStatus,
  inventoryStatusTone,
  ServiceInventoryPage,
  type InventoryColumn,
} from "./service-inventory";

const labels = { rabbitmq: "RabbitMQ", rocketmq: "RocketMQ" };
const booleanLabel = (value: boolean | null) =>
  value === null ? "—" : value ? "Enabled" : "Disabled";
const storageLabel = (value: number | null) =>
  value === null ? "—" : `${value} GB`;

export function MessagingInventoryPage({
  engine,
  result,
}: {
  engine: MessagingEngine;
  result: CloudResult<MessagingInstance[]>;
}) {
  const label = labels[engine];
  const columns: InventoryColumn<MessagingInstance>[] = [
    {
      header: "Instance",
      render: (item) => (
        <ResourceIdentity
          name={item.name}
          id={item.id}
          href={`/services/dms-${engine}/${encodeURIComponent(item.id)}?projectId=${encodeURIComponent(item.projectId)}`}
        />
      ),
    },
    {
      header: "Status",
      render: (item) => (
        <InventoryStatus tone={inventoryStatusTone(item.status)}>
          {item.status}
        </InventoryStatus>
      ),
    },
    { header: "Version", render: (item) => item.engineVersion },
    { header: "Brokers", render: (item) => item.brokerCount ?? "—" },
    { header: "Storage", render: (item) => storageLabel(item.storageGb) },
    { header: "Private endpoint", render: (item) => item.privateAddress },
    {
      header: "Project / region",
      render: (item) => `${item.projectName} / ${item.region}`,
    },
  ];
  return (
    <ServiceInventoryPage
      active="Databases"
      backHref="/services/databases"
      backLabel="Back to databases"
      title={`DMS for ${label}`}
      icon={MessageSquareMore}
      description={`${label} instances across your selected projects. Inspect connection endpoints, storage, and network placement.`}
      result={result}
      rows={result.data}
      rowKey={(item) => `${item.projectId}:${item.id}`}
      columns={columns}
      empty={`No ${label} instances were returned for the selected projects.`}
      tableTitle={`${label} instances`}
      stats={[
        { label: "Instances", value: result.data.length },
        {
          label: "Running",
          value: result.data.filter(
            (item) => item.status.toUpperCase() === "RUNNING",
          ).length,
          tone: "good",
        },
        {
          label: "Projects",
          value: new Set(result.data.map((item) => item.projectId)).size,
        },
        {
          label: "Public access enabled",
          value: result.data.filter((item) => item.publicAccess === true)
            .length,
        },
      ]}
    />
  );
}

export function MessagingDetailPage({
  engine,
  result,
}: {
  engine: MessagingEngine;
  result: CloudResult<MessagingInstance | null>;
}) {
  const label = labels[engine];
  const backHref = `/services/dms-${engine}`;
  const item = result.data;
  if (!item)
    return (
      <CloudErrorPage
        active="Databases"
        backHref={backHref}
        error={result.error ?? "The instance was not returned by Huawei Cloud."}
      />
    );
  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          backHref={backHref}
          backLabel={`Back to ${label} instances`}
          title={item.name}
          id={item.id}
          eyebrow={`DMS FOR ${label.toUpperCase()}`}
          icon={MessageSquareMore}
          actions={<RefreshButton />}
          description={
            <DataFreshnessText
              isCached={result.isCached}
              updatedAt={result.updatedAt}
            />
          }
          status={
            <InventoryStatus tone={inventoryStatusTone(item.status)}>
              {item.status}
            </InventoryStatus>
          }
        />
        <ConsolePanel title="Instance configuration">
          <FieldGrid
            items={[
              { label: "Version", value: item.engineVersion },
              { label: "Specification", value: item.specification },
              { label: "Brokers", value: item.brokerCount ?? "—" },
              { label: "Storage", value: storageLabel(item.storageGb) },
              {
                label: "Used storage",
                value: storageLabel(item.usedStorageGb),
              },
              { label: "TLS", value: booleanLabel(item.sslEnabled) },
              {
                label: "Availability zones",
                value: item.availabilityZones.join(", ") || "—",
              },
              { label: "Enterprise project", value: item.enterpriseProjectId },
              {
                label: "Project / region",
                value: `${item.projectName} / ${item.region}`,
              },
              { label: "Description", value: item.description },
            ]}
          />
        </ConsolePanel>
        <ConsolePanel title="Connection endpoints">
          <FieldGrid
            items={[
              {
                label:
                  engine === "rocketmq"
                    ? "Private NameServer"
                    : "Private endpoint",
                value: item.privateAddress,
              },
              {
                label:
                  engine === "rocketmq"
                    ? "Public NameServer"
                    : "Public endpoint",
                value: item.publicAddress,
              },
              {
                label: "Public access",
                value: booleanLabel(item.publicAccess),
              },
              ...(engine === "rocketmq"
                ? [
                    { label: "gRPC endpoint", value: item.grpcAddress },
                    { label: "Private brokers", value: item.brokerAddress },
                    {
                      label: "Public brokers",
                      value: item.publicBrokerAddress,
                    },
                  ]
                : []),
            ]}
          />
        </ConsolePanel>
        <ConsolePanel title="Network placement">
          <FieldGrid
            items={[
              { label: "VPC", value: item.vpcName },
              { label: "VPC ID", value: item.vpcId },
              { label: "Subnet ID", value: item.subnetId },
              { label: "Security group ID", value: item.securityGroupId },
            ]}
          />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
