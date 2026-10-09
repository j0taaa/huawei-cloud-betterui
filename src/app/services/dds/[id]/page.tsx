import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  DatabaseBackup,
  FileJson,
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
import { DdsInstanceActions } from "@/components/dds-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getDdsInstanceDetails, withCloudResult } from "@/lib/huawei-cloud";

export default async function DdsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getDdsInstanceDetails(session, id),
    cloudCacheKeys.dds(id),
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/dds"
        error={result.error}
      />
    );
  const details = result.data;
  if (!details) notFound();

  const { backups, instance } = details;
  const nodeRows = instance.groups.flatMap((group) =>
    group.nodes.map((node) => ({ group, node })),
  );
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
              <DdsInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/dds"
          backLabel="Back to DDS"
          description={freshness}
          eyebrow="DDS instance"
          icon={FileJson}
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
            description="Mongos, shard, config, replica set, and single-node topology when returned by DDS."
            icon={Server}
            title="Topology"
          >
            <SimpleTable
              columns={[
                { header: "Group" },
                { header: "Type" },
                { header: "Status" },
                { header: "Storage" },
                { header: "Nodes" },
              ]}
              emptyState={
                <TableEmptyText>
                  DDS did not return group-level topology for this instance.
                </TableEmptyText>
              }
              minWidthClassName="min-w-[760px]"
              rows={instance.groups.map((group) => ({
                cells: [
                  <ResourceIdentity
                    id={group.id}
                    key="group"
                    name={group.name}
                  />,
                  group.type,
                  <StatusBadge key="status" status={group.status} />,
                  <CellStack key="storage" subValue={group.storageType}>
                    {group.storage}
                  </CellStack>,
                  group.nodes.length,
                ],
                key: group.id,
              }))}
            />
          </ConsolePanel>
          <ConsolePanel
            description="Recent automated and manual backups returned by the DDS backup API."
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
        <ConsolePanel
          description="Node role, health, endpoint, and availability zone."
          icon={Server}
          title="Nodes"
        >
          <SimpleTable
            columns={[
              { header: "Node" },
              { header: "Group" },
              { header: "Role" },
              { header: "Status" },
              { header: "Private IP" },
              { header: "AZ" },
            ]}
            emptyState={
              <TableEmptyText>
                DDS did not return node-level details for this instance.
              </TableEmptyText>
            }
            minWidthClassName="min-w-[900px]"
            rows={nodeRows.map(({ node }) => ({
              cells: [
                <ResourceIdentity id={node.id} key="node" name={node.name} />,
                <CellStack key="group" subValue={node.groupType}>
                  {node.groupName}
                </CellStack>,
                node.role,
                <StatusBadge key="status" status={node.status} />,
                node.privateIp,
                node.availabilityZone,
              ],
              key: node.id,
            }))}
          />
        </ConsolePanel>
        <FactGrid items={lifecycleFacts} />
      </ConsoleMain>
    </ConsoleShell>
  );
}
