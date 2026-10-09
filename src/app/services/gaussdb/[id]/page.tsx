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
import { GaussDbInstanceActions } from "@/components/gaussdb-instance-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getGaussDbDetails, withCloudResult } from "@/lib/huawei-cloud";

function DateValue({ value }: { value: string }) {
  return value === "-" ? "-" : <LocalDateTime value={value} />;
}

export default async function GaussDbDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getGaussDbDetails(session, id),
    cloudCacheKeys.gaussDb(id),
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Databases"
        backHref="/services/gaussdb"
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
    { label: "Created", value: <DateValue value={instance.createdAt} /> },
    { label: "Updated", value: <DateValue value={instance.updatedAt} /> },
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
              <GaussDbInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/gaussdb"
          backLabel="Back to GaussDB"
          description={freshness}
          eyebrow="GaussDB instance"
          icon={Database}
          iconClassName="bg-[#e9f8f1] text-[#15803d]"
          id={instance.id}
          title={instance.name}
        />

        <FactGrid items={summaryFacts} />

        <ConsolePanelGrid>
          <ConsolePanel
            description="Private endpoint, public access, VPC placement, and project scope."
            icon={Network}
            iconClassName="text-[#15803d]"
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
            description="Console fields used for lifecycle, backup, and maintenance checks."
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
            description="CN, DN, and component information returned by GaussDB."
            icon={Server}
            iconClassName="text-[#15803d]"
            title="Topology"
          >
            <SimpleTable
              columns={[
                { header: "Node" },
                { header: "Role" },
                { header: "Status" },
                { header: "Private IP" },
                { header: "Components" },
                { header: "AZ" },
              ]}
              emptyState={
                <TableEmptyText>
                  GaussDB did not return node-level details for this instance.
                </TableEmptyText>
              }
              minWidthClassName="min-w-[700px]"
              rows={instance.nodes.map((node) => ({
                cells: [
                  <ResourceIdentity id={node.id} key="node" name={node.name} />,
                  node.role,
                  <StatusBadge key="status" status={node.status} />,
                  node.privateIp,
                  node.components.length
                    ? node.components.map((component) => (
                        <p key={`${node.id}:${component.id}`}>
                          {component.type} / {component.role} /{" "}
                          {component.status}
                        </p>
                      ))
                    : "-",
                  node.availabilityZone,
                ],
                key: node.id,
              }))}
            />
          </ConsolePanel>

          <ConsolePanel
            description="Recent manual and automated full backups returned by GaussDB."
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
