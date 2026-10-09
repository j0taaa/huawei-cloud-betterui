import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  DatabaseBackup,
  DatabaseZap,
  Network,
  Server,
  Shield,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsolePanel,
  ConsolePanelGrid,
  CellStack,
  DataFreshnessText,
  FactGrid,
  FieldGrid,
  ResourceDetailHero,
  ResourceIdentity,
  SimpleTable,
  StatusBadge,
  TableEmptyText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { TaurusDbInstanceActions } from "@/components/taurusdb-instance-actions";
import {
  getTaurusDbInstanceDetails,
  withCloudResult,
} from "@/lib/huawei-cloud";

export default async function TaurusDbDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getTaurusDbInstanceDetails(session, id),
    cloudCacheKeys.taurusDb(id),
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/taurusdb"
        error={result.error}
      />
    );
  const details = result.data;
  if (!details) notFound();

  const { backups, instance } = details;
  const freshness = (
    <DataFreshnessText
      isCached={result.isCached}
      updatedAt={result.updatedAt}
    />
  );
  const summaryFacts = [
    { label: "Status", value: <StatusBadge status={instance.status} /> },
    { label: "Datastore", value: instance.datastore },
    { label: "Instance type", value: `${instance.type} / ${instance.mode}` },
    { label: "Flavor", value: instance.flavor },
    { label: "Storage", value: `${instance.storage} ${instance.storageType}` },
    { label: "Availability zone", value: instance.availabilityZone },
  ];
  const lifecycleFacts = [
    {
      label: "Created",
      value:
        instance.createdAt === "-" ? (
          "-"
        ) : (
          <LocalDateTime value={instance.createdAt} />
        ),
    },
    {
      label: "Updated",
      value:
        instance.updatedAt === "-" ? (
          "-"
        ) : (
          <LocalDateTime value={instance.updatedAt} />
        ),
    },
    { label: "Tags", value: instance.tags.length },
  ];

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={
            <>
              <TaurusDbInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/taurusdb"
          backLabel="Back to TaurusDB"
          description={freshness}
          eyebrow="TaurusDB instance"
          icon={DatabaseZap}
          iconClassName="bg-[#e9f8f1] text-[#15803d]"
          id={instance.id}
          title={instance.name}
        />
        <FactGrid items={summaryFacts} />
        <ConsolePanelGrid>
          <ConsolePanel
            description="Write, read-only, proxy, and public endpoints returned by TaurusDB."
            icon={Network}
            iconClassName="text-[#15803d]"
            title="Connectivity"
          >
            <FieldGrid
              items={[
                { label: "Write private IP", value: instance.privateIp },
                {
                  label: "Read-only private IP",
                  value: instance.readOnlyPrivateIp,
                },
                { label: "Proxy IP", value: instance.proxyIp },
                { label: "Public IP", value: instance.publicIp },
                { label: "Port", value: instance.port },
                { label: "VPC", value: instance.vpcId },
                { label: "Subnet", value: instance.subnetId },
                { label: "Security group", value: instance.securityGroupId },
                {
                  label: "Project",
                  value: `${instance.projectName} / ${instance.region}`,
                },
              ]}
            />
          </ConsolePanel>
          <ConsolePanel
            description="Console fields used for lifecycle and protection checks."
            icon={Shield}
            iconClassName="text-[#15803d]"
            title="Operations"
          >
            <FieldGrid
              items={[
                { label: "Backup window", value: instance.backupWindow },
                {
                  label: "Retention",
                  value: `${instance.backupKeepDays} days`,
                },
                {
                  label: "Maintenance window",
                  value: instance.maintenanceWindow,
                },
                { label: "Billing mode", value: instance.chargeMode },
                {
                  label: "Enterprise project",
                  value: instance.enterpriseProjectId,
                },
                {
                  label: "Dedicated resource",
                  value: instance.dedicatedResourceId,
                },
                { label: "DB user", value: instance.dbUserName },
                { label: "Time zone", value: instance.timeZone },
              ]}
            />
          </ConsolePanel>
        </ConsolePanelGrid>
        <ConsolePanelGrid>
          <ConsolePanel
            description="Primary and read replica node information when returned by TaurusDB."
            icon={Server}
            iconClassName="text-[#15803d]"
            title="Nodes"
          >
            <SimpleTable
              columns={[
                { header: "Node" },
                { header: "Role" },
                { header: "Status" },
                { header: "Private IP" },
                { header: "AZ" },
              ]}
              emptyState={
                <TableEmptyText>
                  TaurusDB did not return node-level details for this instance.
                </TableEmptyText>
              }
              minWidthClassName="min-w-[620px]"
              rows={instance.nodes.map((node) => ({
                cells: [
                  <ResourceIdentity id={node.id} key="node" name={node.name} />,
                  node.role,
                  <StatusBadge key="status" status={node.status} />,
                  node.privateIp,
                  node.availabilityZone,
                ],
                key: node.id,
              }))}
            />
          </ConsolePanel>
          <ConsolePanel
            description="Recent full backups returned by the TaurusDB backup APIs."
            icon={DatabaseBackup}
            iconClassName="text-[#15803d]"
            title="Backups"
          >
            <SimpleTable
              columns={[
                { header: "Backup" },
                { header: "Type" },
                { header: "Status" },
                { header: "Size" },
                { header: "Window" },
              ]}
              emptyState={
                <TableEmptyText>
                  No backups were returned for this instance.
                </TableEmptyText>
              }
              minWidthClassName="min-w-[680px]"
              rows={backups.map((backup) => ({
                cells: [
                  <ResourceIdentity
                    id={backup.id}
                    key="backup"
                    name={backup.name}
                  />,
                  backup.type,
                  <StatusBadge key="status" status={backup.status} />,
                  backup.size,
                  <CellStack key="window" subValue={backup.endTime}>
                    {backup.beginTime}
                  </CellStack>,
                ],
                key: backup.id,
              }))}
            />
          </ConsolePanel>
        </ConsolePanelGrid>
        <FactGrid items={lifecycleFacts} />
      </ConsoleMain>
    </ConsoleShell>
  );
}
