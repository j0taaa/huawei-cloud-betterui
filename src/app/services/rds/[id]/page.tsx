import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Database,
  DatabaseBackup,
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
import { RdsInstanceActions } from "@/components/rds-instance-actions";
import { getRdsInstanceDetails, withCloudResult } from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

export default async function RdsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getRdsInstanceDetails(session, id),
    cloudCacheKeys.rds(id),
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/rds"
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
    { label: "Time zone", value: instance.timeZone },
  ];

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={
            <>
              <RdsInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/rds"
          backLabel="Back to RDS"
          description={freshness}
          eyebrow="RDS instance"
          icon={Database}
          id={instance.id}
          title={instance.name}
        />
        <FactGrid items={summaryFacts} />
        <ConsolePanelGrid>
          <ConsolePanel
            description="Private endpoint, VPC placement, and project scope."
            icon={Network}
            title="Connectivity"
          >
            <FieldGrid
              items={[
                { label: "Private IP", value: instance.privateIp },
                { label: "Public IP", value: instance.publicIp },
                { label: "Port", value: instance.port },
                { label: "VPC", value: instance.vpcId },
                { label: "Subnet", value: instance.subnetId },
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
                { label: "Switch strategy", value: instance.switchStrategy },
                { label: "Billing mode", value: instance.chargeMode },
                {
                  label: "Enterprise project",
                  value: instance.enterpriseProjectId,
                },
              ]}
            />
          </ConsolePanel>
        </ConsolePanelGrid>
        <ConsolePanelGrid>
          <ConsolePanel
            description="Primary, standby, and read replica node information when returned by RDS."
            icon={Server}
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
                  RDS did not return node-level details for this instance.
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
            description="Recent full and incremental backups returned by the RDS backup API."
            icon={DatabaseBackup}
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
