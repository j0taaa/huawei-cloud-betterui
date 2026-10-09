import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Braces,
  DatabaseBackup,
  HardDrive,
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
import { GeminiDbInstanceActions } from "@/components/geminidb-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getGeminiDbDetails, withCloudResult } from "@/lib/huawei-cloud";

function dateValue(value: string) {
  return value === "-" ? "-" : <LocalDateTime value={value} />;
}

export default async function GeminiDbDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getGeminiDbDetails(session, id),
    `geminidb-instance:${id}`,
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/geminidb"
        error={result.error}
      />
    );
  const details = result.data;
  if (!details) notFound();

  const { backups, backupPolicy, instance } = details;
  const nodeRows = instance.groups.flatMap((group) =>
    group.nodes.map((node) => ({
      groupId: group.id,
      node,
    })),
  );
  const freshness = (
    <DataFreshnessText
      isCached={result.isCached}
      updatedAt={result.updatedAt}
    />
  );
  const summaryFacts = [
    { label: "Status", value: <StatusBadge status={instance.status} /> },
    { label: "API", value: instance.apiType },
    { label: "Datastore", value: instance.datastore },
    { label: "Mode", value: instance.mode },
    {
      label: "Storage",
      value: `${instance.storage} used ${instance.volumeUsed}`,
    },
    { label: "Availability zone", value: instance.availabilityZone },
  ];

  return (
    <ConsoleShell active="Databases">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={
            <>
              <GeminiDbInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/geminidb"
          backLabel="Back to GeminiDB"
          description={freshness}
          eyebrow="GeminiDB instance"
          icon={Braces}
          id={instance.id}
          title={instance.name}
        />
        <FactGrid items={summaryFacts} />
        <ConsolePanelGrid>
          <ConsolePanel
            description="Private endpoint, load balancer endpoint, and VPC placement."
            icon={Network}
            title="Connectivity"
          >
            <FieldGrid
              items={[
                { label: "Private IP", value: instance.privateIp },
                { label: "Public IP", value: instance.publicIp },
                { label: "Load balancer IP", value: instance.lbIpAddress },
                { label: "Load balancer port", value: instance.lbPort },
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
            description="Backup, maintenance, billing, and patch fields returned by GeminiDB."
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
                { label: "Backup period", value: instance.backupPeriod },
                {
                  label: "Policy",
                  value: backupPolicy
                    ? `${backupPolicy.startTime} / ${backupPolicy.keepDays} days`
                    : "-",
                },
                {
                  label: "Maintenance window",
                  value: instance.maintenanceWindow,
                },
                { label: "Billing mode", value: instance.payMode },
                { label: "Patch available", value: instance.patchAvailable },
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
            description="Groups, volume allocation, and node membership returned by the instance API."
            icon={HardDrive}
            title="Groups"
          >
            <SimpleTable
              columns={[
                { header: "Group" },
                { header: "Status" },
                { header: "Nodes" },
                { header: "Volume" },
              ]}
              emptyState={
                <TableEmptyText>
                  GeminiDB did not return group-level details for this instance.
                </TableEmptyText>
              }
              minWidthClassName="min-w-[680px]"
              rows={instance.groups.map((group) => ({
                cells: [
                  <span className="break-all font-black" key="group">
                    {group.id}
                  </span>,
                  <StatusBadge key="status" status={group.status} />,
                  group.nodes.length,
                  <CellStack key="volume" subValue={`Used ${group.volumeUsed}`}>
                    {group.volumeSize}
                  </CellStack>,
                ],
                key: group.id,
              }))}
            />
          </ConsolePanel>
          <ConsolePanel
            description="Node role, status, endpoint, specification, and availability zone."
            icon={Server}
            title="Nodes"
          >
            <SimpleTable
              columns={[
                { header: "Node" },
                { header: "Role" },
                { header: "Status" },
                { header: "Private IP" },
                { header: "Spec" },
                { header: "AZ" },
              ]}
              emptyState={
                <TableEmptyText>
                  GeminiDB did not return node-level details for this instance.
                </TableEmptyText>
              }
              minWidthClassName="min-w-[780px]"
              rows={nodeRows.map(({ groupId, node }) => ({
                cells: [
                  <ResourceIdentity
                    id={node.id}
                    key="node"
                    name={node.name}
                    scope={groupId}
                  />,
                  node.role,
                  <StatusBadge key="status" status={node.status} />,
                  node.privateIp,
                  node.specCode,
                  node.availabilityZone,
                ],
                key: node.id,
              }))}
            />
          </ConsolePanel>
        </ConsolePanelGrid>
        <ConsolePanelGrid>
          <ConsolePanel
            description="Recent backups returned by the GeminiDB backup API."
            icon={DatabaseBackup}
            title="Backups"
          >
            <SimpleTable
              columns={[
                { header: "Backup" },
                { header: "Type" },
                { header: "Status" },
                { header: "Size" },
                { header: "Created" },
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
                  dateValue(backup.createdAt),
                ],
                key: backup.id,
              }))}
            />
          </ConsolePanel>
          <ConsolePanel
            description="Creation, update, owner, and engine metadata."
            icon={Braces}
            title="Metadata"
          >
            <FieldGrid
              items={[
                { label: "Created", value: dateValue(instance.createdAt) },
                { label: "Updated", value: dateValue(instance.updatedAt) },
                { label: "Time zone", value: instance.timeZone },
                { label: "DB user", value: instance.dbUserName },
                { label: "Engine", value: instance.engine },
                {
                  label: "Console actions",
                  value: instance.actions.join(", ") || "-",
                },
              ]}
            />
          </ConsolePanel>
        </ConsolePanelGrid>
      </ConsoleMain>
    </ConsoleShell>
  );
}
