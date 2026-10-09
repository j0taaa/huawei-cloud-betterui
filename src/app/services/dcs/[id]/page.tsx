import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Clock,
  DatabaseZap,
  HardDrive,
  KeyRound,
  Network,
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
  ResourceIdentity,
  SimpleTable,
  StatusBadge,
  UsageMeter,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { DcsInstanceActions } from "@/components/dcs-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getDcsRedisDetails, withCloudResult } from "@/lib/huawei-cloud";
import type {
  DcsRedisDetails,
  DcsRedisInstanceDetails,
} from "@/lib/huawei-cloud";

function memoryPercent(instance: DcsRedisInstanceDetails) {
  return instance.maxMemoryMb > 0
    ? Math.min(
        100,
        Math.round((instance.usedMemoryMb / instance.maxMemoryMb) * 100),
      )
    : 0;
}

export default async function DcsRedisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult<DcsRedisDetails | null>(
    null,
    (session) => getDcsRedisDetails(session, id),
    `dcs-instance:${id}`,
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/dcs"
        error={result.error}
      />
    );
  const details = result.data;

  if (!details) notFound();

  const { backups, instance } = details;
  const percent = memoryPercent(instance);
  const freshness = (
    <DataFreshnessText
      isCached={result.isCached}
      updatedAt={result.updatedAt}
    />
  );
  const summaryFacts = [
    { label: "Status", value: <StatusBadge status={instance.status} /> },
    { label: "Engine", value: `${instance.engine} ${instance.engineVersion}` },
    {
      label: "Topology",
      value: `${instance.mode} / ${instance.nodeCount || "-"} nodes`,
    },
    { label: "Capacity", value: instance.capacity },
  ];

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={
            <>
              <DcsInstanceActions
                engineVersion={instance.engineVersion}
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/dcs"
          backLabel="Back to DCS Redis"
          description={freshness}
          eyebrow="DCS Redis instance"
          icon={DatabaseZap}
          iconClassName="bg-[#e9f8f1] text-[#15803d]"
          id={instance.id}
          title={instance.name}
        />

        <FactGrid items={summaryFacts} />

        <ConsolePanelGrid>
          <ConsolePanel
            description="Private endpoint, public access, and VPC placement."
            icon={Network}
            iconClassName="text-[#15803d]"
            title="Connectivity"
          >
            <FieldGrid
              items={[
                {
                  label: "Connection address",
                  value: instance.connectionAddress,
                },
                { label: "Port", value: instance.port },
                { label: "Domain name", value: instance.domainName },
                {
                  label: "Read-only domain",
                  value: instance.readOnlyDomainName,
                },
                { label: "Private IP", value: instance.ip },
                { label: "Public access", value: instance.publicAccessEnabled },
                { label: "Public IP", value: instance.publicIpAddress },
                { label: "Public IP ID", value: instance.publicIpId },
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
              ]}
            />
          </ConsolePanel>

          <ConsolePanel
            description="Memory usage and the Huawei spec identifiers returned by DCS."
            icon={HardDrive}
            iconClassName="text-[#15803d]"
            title="Capacity"
          >
            <UsageMeter percent={percent} tone="green">
              <FieldGrid
                items={[
                  {
                    label: "Used memory",
                    value: `${instance.usedMemory} (${percent}%)`,
                  },
                  { label: "Max memory", value: instance.maxMemory },
                  { label: "Capacity", value: instance.capacity },
                  { label: "Spec code", value: instance.resourceSpecCode },
                  { label: "CPU type", value: instance.cpuType },
                  { label: "Storage type", value: instance.storageType },
                ]}
              />
            </UsageMeter>
          </ConsolePanel>
        </ConsolePanelGrid>

        <ConsolePanelGrid>
          <ConsolePanel
            description="Access controls, encryption, and operation state."
            icon={Shield}
            iconClassName="text-[#15803d]"
            title="Security and Operations"
          >
            <FieldGrid
              items={[
                {
                  label: "Password-free access",
                  value: instance.noPasswordAccess,
                },
                { label: "Access user", value: instance.accessUser },
                { label: "SSL enabled", value: instance.sslEnabled },
                {
                  label: "Transparent client IP",
                  value: instance.transparentClientIp,
                },
                {
                  label: "Maintenance window",
                  value: instance.maintenanceWindow,
                },
                { label: "Billing mode", value: instance.chargingMode },
                { label: "Sub status", value: instance.subStatus },
                { label: "Task", value: instance.task },
                { label: "Service upgrade", value: instance.serviceUpgrade },
                { label: "Service task", value: instance.serviceTaskId },
                {
                  label: "Enterprise project",
                  value: `${instance.enterpriseProjectName} / ${instance.enterpriseProjectId}`,
                },
                {
                  label: "Project",
                  value: `${instance.projectName} / ${instance.region}`,
                },
              ]}
            />
          </ConsolePanel>

          <ConsolePanel
            description="Availability zones and creation timestamps."
            icon={Clock}
            iconClassName="text-[#15803d]"
            title="Placement"
          >
            <FieldGrid
              items={[
                {
                  label: "Availability zones",
                  value: instance.availabilityZones.join(", ") || "-",
                },
                {
                  label: "AZ codes",
                  value: instance.azCodes.join(", ") || "-",
                },
                {
                  label: "Created",
                  value: <LocalDateTime value={instance.createdAt} />,
                },
                {
                  label: "Launched",
                  value: <LocalDateTime value={instance.launchedAt} />,
                },
                {
                  label: "Backend addresses",
                  value: instance.backendAddresses,
                },
                { label: "Description", value: instance.description },
              ]}
            />
          </ConsolePanel>
        </ConsolePanelGrid>

        <ConsolePanelGrid>
          <ConsolePanel
            description="Recent backup records when returned by DCS."
            icon={KeyRound}
            iconClassName="text-[#15803d]"
            title="Backups"
          >
            <SimpleTable
              columns={[
                { header: "Backup" },
                { header: "Status" },
                { header: "Size" },
                { header: "Created" },
              ]}
              emptyState="No backup records were returned."
              minWidthClassName="min-w-[760px]"
              rows={backups.map((backup) => ({
                cells: [
                  <ResourceIdentity
                    id={backup.id}
                    key="backup"
                    name={backup.name}
                    scope={`${backup.type} / ${backup.backupFormat}`}
                  />,
                  <StatusBadge key="status" status={backup.status} />,
                  backup.size,
                  <LocalDateTime key="created" value={backup.createdAt} />,
                ],
                key: backup.id,
              }))}
            />
          </ConsolePanel>

          <div className="grid gap-6">
            <ConsolePanel
              description="Console feature flags exposed by the instance API."
              icon={Tags}
              iconClassName="text-[#15803d]"
              title="Features"
            >
              <KeyValueGrid
                emptyState="No feature flags were returned."
                items={instance.features}
              />
            </ConsolePanel>
            <ConsolePanel
              description="User-defined resource tags."
              icon={Tags}
              iconClassName="text-[#15803d]"
              title="Tags"
            >
              <KeyValueGrid
                emptyState="No tags were returned."
                items={instance.tags}
              />
            </ConsolePanel>
          </div>
        </ConsolePanelGrid>
      </ConsoleMain>
    </ConsoleShell>
  );
}
