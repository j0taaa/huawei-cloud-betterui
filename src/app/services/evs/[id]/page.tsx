import { combineCloudLoads, mapCloudLoad } from "@/lib/huawei/errors";
import { CloudErrorPage } from "@/components/cloud-error";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  Camera,
  DatabaseBackup,
  HardDrive,
  History,
  Layers,
  MapPin,
  ReceiptText,
  Server,
  ShieldCheck,
  Tags,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  CellStack,
  ConsoleCallout,
  ConsoleInsetPanel,
  ConsoleMain,
  ConsoleMutedText,
  ConsolePanel,
  ConsolePanelGrid,
  ConsolePill,
  ConsoleResponsiveGrid,
  ConsoleStatCardGrid,
  ConsoleSurface,
  DataFreshnessText,
  FieldGrid,
  MetricCard,
  ResourceDetailHero,
  ResourceIdentity,
  SimpleTable,
  StatusBadge,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { EcsMonitoringChart } from "@/components/ecs-monitoring-chart";
import { CreateEvsBackupButton, ExportEvsSnapshotsButton } from "@/components/evs-detail-actions";
import {
  AttachDetachEvsDiskButton,
  CreateEvsDiskFromSnapshotButton,
  CreateEvsSnapshotButton,
  DeleteEvsDiskButton,
  DeleteEvsSnapshotButton,
  EditEvsDiskButton,
  ExtendEvsDiskButton,
  RollbackEvsSnapshotButton,
} from "@/components/evs-disk-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { MonthlyResourceCostCard } from "@/components/monthly-resource-cost-card";
import {
  getEvsDisk,
  getEvsMonitoring,
  listCbrBackups,
  listCbrVaults,
  listCtsTraces,
  listEcsInstances,
  listEvsSnapshots,
  withCloudResult,
  type CbrBackup,
  type CbrVault,
  type CtsTrace,
  type EvsDisk,
  type EvsMonitoring,
  type EvsSnapshot,
} from "@/lib/huawei-cloud";

const tabs = [
  { id: "overview", icon: HardDrive, label: "Overview" },
  { id: "snapshots", icon: Camera, label: "Snapshots" },
  { id: "backups", icon: DatabaseBackup, label: "Backups" },
  { id: "monitoring", icon: Activity, label: "Monitoring" },
  { id: "tags", icon: Tags, label: "Tags" },
  { id: "activity", icon: History, label: "Activity" },
] as const;

type EvsTab = (typeof tabs)[number]["id"];

function isEvsTab(value: string | undefined): value is EvsTab {
  return tabs.some((tab) => tab.id === value);
}

function truthyLabel(value: string) {
  return value === "true" ? "Yes" : value === "false" ? "No" : value || "-";
}

function OverviewTab({
  attachedHref,
  attachedName,
  disk,
}: {
  attachedHref?: string;
  attachedName?: string;
  disk: EvsDisk;
}) {
  return (
    <>
      <ConsoleStatCardGrid columns={5}>
        <MonthlyResourceCostCard region={disk.region} resourceId={disk.id} />
        <MetricCard icon={HardDrive} label="Capacity" value={disk.size} variant="compact" />
        <MetricCard icon={Layers} label="Storage class" value={disk.typeLabel} variant="compact" />
        <MetricCard
          icon={Server}
          iconClassName={disk.attachedServerId ? "bg-[#ecfdf3] text-[#027a48]" : undefined}
          label="Attachment"
          value={disk.attachedServerId ? "Attached" : "Available"}
          variant="compact"
        />
        <MetricCard
          icon={ShieldCheck}
          iconClassName={disk.isEncrypted === "true" ? "bg-[#ecfdf3] text-[#027a48]" : "bg-[#fff7ed] text-[#b54708]"}
          label="Encryption"
          value={truthyLabel(disk.isEncrypted)}
          variant="compact"
        />
      </ConsoleStatCardGrid>

      <ConsoleResponsiveGrid className="gap-5" variant="xl-2">
        <ConsolePanel icon={HardDrive} title="Storage">
          <FieldGrid
            items={[
              { label: "Size", value: disk.size },
              { label: "Disk type", value: <CellStack subValue={disk.type}>{disk.typeLabel}</CellStack> },
              { label: "Bootable", value: truthyLabel(disk.isBootable) },
              { label: "Shared disk", value: truthyLabel(disk.isShareable) },
            ]}
          />
        </ConsolePanel>
        <ConsolePanel icon={Server} title="Attachment">
          <FieldGrid
            items={[
              {
                label: "ECS instance",
                value: disk.attachedServerId ? (
                  <ResourceIdentity href={attachedHref} id={disk.attachedServerId} name={attachedName} />
                ) : "Not attached",
              },
              { label: "Device", value: disk.attachedDevice || "-" },
              { label: "Attachment status", value: disk.attachedServerId ? "Connected to ECS" : "Available for attach" },
            ]}
          />
        </ConsolePanel>
        <ConsolePanel icon={MapPin} title="Placement">
          <FieldGrid
            items={[
              { label: "Availability zone", value: disk.availabilityZone },
              { label: "Project", value: <CellStack subValue={disk.projectId}>{disk.projectName}</CellStack> },
              { label: "Region", value: disk.region },
            ]}
          />
        </ConsolePanel>
        <ConsolePanel icon={ShieldCheck} title="Lifecycle and protection">
          <FieldGrid
            items={[
              { label: "Encrypted", value: truthyLabel(disk.isEncrypted) },
              { label: "Created", value: <LocalDateTime value={disk.createdAt} /> },
              { label: "Delete eligibility", value: disk.attachedServerId ? "Detach before deleting" : "Eligible for deletion" },
              { label: "Billing mode", value: "Pay-per-use or account contract" },
            ]}
          />
        </ConsolePanel>
      </ConsoleResponsiveGrid>

      <ConsoleResponsiveGrid variant="lg-1.1-0.9">
        <ConsolePanel icon={ReceiptText} title="Disk description">
          <p className="whitespace-pre-wrap p-5 text-sm font-semibold leading-6 text-[#475467] dark:text-[#cbd5e1]">
            {disk.description || "No description set."}
          </p>
        </ConsolePanel>
        <ConsolePanel description="Attached and in-use disks are blocked before the API call." icon={ShieldCheck} iconClassName="text-[#039855]" title="Deletion guardrails">
          <div className="p-5 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
            Detach the disk from ECS before using destructive actions.
          </div>
        </ConsolePanel>
      </ConsoleResponsiveGrid>
    </>
  );
}

function SnapshotsTab({
  availabilityZones,
  disk,
  snapshots,
}: {
  availabilityZones: string[];
  disk: EvsDisk;
  snapshots: EvsSnapshot[];
}) {
  return (
    <ConsolePanel
      actions={<ExportEvsSnapshotsButton fileName={`${disk.name}-snapshots.csv`} snapshots={snapshots} />}
      description="Point-in-time copies for this EVS disk."
      icon={Camera}
      title="Snapshots"
    >
      <SimpleTable
        columns={[
          { header: "Name" }, { header: "Status" }, { header: "Size" },
          { header: "Created" }, { header: "Project" },
          { className: "text-right", header: "Actions", headerClassName: "text-right" },
        ]}
        emptyState={<ConsoleMutedText>No snapshots returned for this disk.</ConsoleMutedText>}
        minWidthClassName="min-w-[900px]"
        rows={snapshots.map((snapshot) => ({
          cells: [
            <ResourceIdentity id={snapshot.id} key="name" name={snapshot.name} />,
            <StatusBadge key="status" status={snapshot.status} />,
            snapshot.size,
            <LocalDateTime key="created" value={snapshot.createdAt} />,
            <CellStack key="project" subValue={snapshot.region}>{snapshot.projectName}</CellStack>,
            <div className="flex flex-wrap justify-end gap-2" key="actions">
              <CreateEvsDiskFromSnapshotButton availabilityZones={availabilityZones} snapshot={snapshot} sourceDisk={disk} volumeTypes={[disk.type]} />
              <RollbackEvsSnapshotButton snapshot={snapshot} />
              <DeleteEvsSnapshotButton snapshot={snapshot} />
            </div>,
          ],
          key: snapshot.id,
        }))}
      />
    </ConsolePanel>
  );
}

function BackupsTab({ backups, disk, vaults }: { backups: CbrBackup[]; disk: EvsDisk; vaults: CbrVault[] }) {
  return (
    <div className="grid gap-5">
      <ConsolePanel
        actions={(
          <CreateEvsBackupButton
            disk={disk}
            vaults={vaults.map((vault) => ({
              id: vault.id,
              name: vault.name,
              policyNames: vault.policies.map((policy) => policy.name),
              projectId: vault.projectId,
              status: vault.status,
            }))}
          />
        )}
        description="CBR restore points created for this disk."
        icon={DatabaseBackup}
        title="Disk backups"
      >
        <SimpleTable
          columns={[{ header: "Backup" }, { header: "Status" }, { header: "Size" }, { header: "Created" }, { header: "Vault" }, { header: "Type" }]}
          emptyState={<ConsoleMutedText>No CBR backups returned for this disk.</ConsoleMutedText>}
          minWidthClassName="min-w-[860px]"
          rows={backups.map((backup) => {
            const vault = vaults.find((item) => item.id === backup.vaultId);
            return {
              cells: [
                <ResourceIdentity id={backup.id} key="backup" name={backup.name} />,
                <StatusBadge key="status" status={backup.status} />,
                `${backup.resourceSizeGb} GB`,
                <LocalDateTime key="created" value={backup.createdAt || backup.protectedAt} />,
                vault ? <ResourceIdentity href="/services/cbr" id={vault.id} key="vault" name={vault.name} /> : backup.vaultId,
                backup.incremental ? "Incremental" : "Full",
              ],
              key: backup.id,
            };
          })}
        />
      </ConsolePanel>

      <ConsolePanel description="Vaults currently protecting this EVS disk." icon={ShieldCheck} title="Protection relationships">
        <SimpleTable
          columns={[{ header: "Vault" }, { header: "Status" }, { header: "Capacity" }, { header: "Policies" }, { header: "Billing" }]}
          emptyState={<ConsoleMutedText>This disk is not associated with a CBR disk backup vault.</ConsoleMutedText>}
          minWidthClassName="min-w-[760px]"
          rows={vaults.map((vault) => ({
            cells: [
              <ResourceIdentity href="/services/cbr" id={vault.id} key="vault" name={vault.name} />,
              <StatusBadge key="status" status={vault.status} />,
              `${vault.usedGb} / ${vault.sizeGb} GB`,
              vault.policies.length ? vault.policies.map((policy) => policy.name).join(", ") : "No policy",
              vault.chargingMode,
            ],
            key: vault.id,
          }))}
        />
      </ConsolePanel>
    </div>
  );
}

function MonitoringTab({ disk, monitoring }: { disk: EvsDisk; monitoring: EvsMonitoring | null }) {
  if (!monitoring) return <ConsoleCallout>Cloud Eye monitoring data could not be loaded.</ConsoleCallout>;

  if (!monitoring.dimensionValue) {
    return (
      <ConsoleInsetPanel className="p-10 text-center" dashed title="Attach the disk to view Cloud Eye metrics.">
        Huawei EVS metrics use the attached server ID and device name as the `disk_name` dimension.
      </ConsoleInsetPanel>
    );
  }

  return (
    <ConsolePanelGrid className="gap-5">
      {monitoring.metrics.map((metric) => (
        <ConsoleSurface
          actions={<ConsolePill tone="info">{metric.namespace} · {metric.metricName}</ConsolePill>}
          description={`${monitoring.region} · ${monitoring.dimensionValue}`}
          key={metric.metricName}
          title={metric.label}
        >
          {metric.datapoints.length ? (
            <EcsMonitoringChart datapoints={metric.datapoints} unit={metric.unit} />
          ) : (
            <div className="p-6">
              <ConsoleInsetPanel className="p-8 text-center" dashed title="No Cloud Eye datapoints returned.">
                The disk must be attached and receiving I/O. CES data can also be delayed or restricted by IAM permissions.
              </ConsoleInsetPanel>
            </div>
          )}
        </ConsoleSurface>
      ))}
      <span className="sr-only">Monitoring for {disk.name}</span>
    </ConsolePanelGrid>
  );
}

function TagsTab({ disk }: { disk: EvsDisk }) {
  return (
    <ConsolePanel description="Resource labels returned by EVS." icon={Tags} title="Tags">
      <SimpleTable
        columns={[{ header: "Key" }, { header: "Value" }]}
        emptyState={<ConsoleMutedText>No tags are assigned to this disk.</ConsoleMutedText>}
        minWidthClassName="min-w-[560px]"
        rows={disk.tags.map((tag) => ({ cells: [tag.key, tag.value], key: `${tag.key}:${tag.value}` }))}
      />
    </ConsolePanel>
  );
}

function ActivityTab({ traces }: { traces: CtsTrace[] }) {
  return (
    <ConsolePanel description="Recent Cloud Trace Service operations associated with this disk." icon={History} title="Activity">
      <SimpleTable
        columns={[{ header: "Operation" }, { header: "Result" }, { header: "Recorded" }, { header: "User" }, { header: "Source IP" }]}
        emptyState={<ConsoleMutedText>No matching CTS operations were returned in the recent trace window.</ConsoleMutedText>}
        minWidthClassName="min-w-[780px]"
        rows={traces.map((trace) => ({
          cells: [
            <CellStack key="operation" subValue={`${trace.serviceType} · ${trace.traceType}`}>{trace.traceName}</CellStack>,
            <StatusBadge key="result" status={trace.traceRating || trace.code} />,
            <LocalDateTime key="recorded" value={trace.recordedAt} />,
            trace.userName,
            trace.sourceIp,
          ],
          key: trace.id,
        }))}
      />
    </ConsolePanel>
  );
}

export default async function EvsDiskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const activeTab = isEvsTab(query.tab) ? query.tab : "overview";
  const result = await withCloudResult(
    null,
    async (session) => {
      return mapCloudLoad(
        () => combineCloudLoads({ disk: getEvsDisk(session, id), instances: listEcsInstances(session) }, { disk: null, instances: [] }),
        fields => fields.disk ? fields : null,
      );
    },
    `evs-disk:${id}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Storage" backHref="/services/evs" error={result.error} />;
  const disk = result.data?.disk;
  if (!disk) notFound();

  const snapshotsResult = activeTab === "snapshots"
    ? await withCloudResult<EvsSnapshot[]>([], (session) => listEvsSnapshots(session), `evs-disk-snapshots:${id}`)
    : null;
  const backupsResult = activeTab === "backups"
    ? await withCloudResult(
        { backups: [] as CbrBackup[], vaults: [] as CbrVault[] },
        async (session) => {
          return mapCloudLoad(
            () => combineCloudLoads({ backups: listCbrBackups(session), vaults: listCbrVaults(session) }, { backups: [], vaults: [] }),
            ({ backups, vaults }) => ({
            backups: backups.filter((backup) => backup.resourceId === disk.id),
            vaults: vaults.filter(
              (vault) => vault.projectId === disk.projectId && vault.resources.some((resource) => resource.id === disk.id && resource.type === "OS::Cinder::Volume"),
            ),
          }));
        },
        `evs-disk-backups:${id}`,
      )
    : null;
  const monitoringResult = activeTab === "monitoring"
    ? await withCloudResult<EvsMonitoring | null>(null, (session) => getEvsMonitoring(session, id), `evs-monitoring:${id}`)
    : null;
  const activityResult = activeTab === "activity"
    ? await withCloudResult<CtsTrace[]>([], async (session) => {
        const traces = await listCtsTraces(session);
        const names = new Set([disk.id.toLowerCase(), disk.name.toLowerCase()]);
        return traces.filter((trace) => names.has(trace.resourceName.toLowerCase()));
      }, `evs-disk-activity:${id}`)
    : null;

  const instances = result.data?.instances ?? [];
  const attachedInstance = instances.find((instance) => instance.id === disk.attachedServerId);
  const attachedHref = disk.attachedServerId ? `/services/ecs/${disk.attachedServerId}` : undefined;
  const attachedName = attachedInstance?.name ?? disk.attachedServerId;
  const availabilityZones = Array.from(new Set(instances.filter((instance) => instance.projectId === disk.projectId).map((instance) => instance.availabilityZone).filter(Boolean)));
  if (!availabilityZones.includes(disk.availabilityZone)) availabilityZones.unshift(disk.availabilityZone);
  const diskSnapshots = (snapshotsResult?.data ?? []).filter((snapshot) => snapshot.diskId === disk.id);

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing || Boolean(snapshotsResult?.isRefreshing || backupsResult?.isRefreshing || monitoringResult?.isRefreshing || activityResult?.isRefreshing)} />
      <ConsoleMain>
        <ResourceDetailHero
          actions={(
            <>
              <CreateEvsSnapshotButton disks={[disk]} selectedDiskId={disk.id} />
              <EditEvsDiskButton disk={disk} />
              <ExtendEvsDiskButton disk={disk} />
              <AttachDetachEvsDiskButton disk={disk} instances={instances} />
              <DeleteEvsDiskButton attachedTo={disk.attachedTo} diskId={disk.id} diskName={disk.name} projectId={disk.projectId} status={disk.status} />
              <RefreshButton />
            </>
          )}
          backHref="/services/evs"
          backLabel="Back to EVS"
          description={<DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />}
          eyebrow={<span className="inline-flex flex-wrap items-center gap-2">EVS disk <StatusBadge status={disk.status} /></span>}
          icon={HardDrive}
          id={disk.id}
          title={disk.name}
        />

        <nav aria-label="EVS disk sections" className="flex gap-1 overflow-x-auto border-b border-[#dfe5ee] dark:border-white/10">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id === activeTab;
            return (
              <Link
                aria-current={selected ? "page" : undefined}
                className={`relative inline-flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-black ${selected ? "text-[#2563eb]" : "text-[#667085] hover:text-[#1d4ed8] dark:text-[#98a2b3]"}`}
                href={tab.id === "overview" ? `/services/evs/${id}` : `/services/evs/${id}?tab=${tab.id}`}
                key={tab.id}
              >
                <Icon className="size-4" />
                {tab.label}
                {selected ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#2563eb]" /> : null}
              </Link>
            );
          })}
        </nav>

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}
        {snapshotsResult?.error ? <ConsoleCallout>{snapshotsResult.error}</ConsoleCallout> : null}
        {backupsResult?.error ? <ConsoleCallout>{backupsResult.error}</ConsoleCallout> : null}
        {monitoringResult?.error ? <ConsoleCallout>{monitoringResult.error}</ConsoleCallout> : null}
        {activityResult?.error ? <ConsoleCallout>{activityResult.error}</ConsoleCallout> : null}

        {activeTab === "overview" ? <OverviewTab attachedHref={attachedHref} attachedName={attachedName} disk={disk} /> : null}
        {activeTab === "snapshots" ? <SnapshotsTab availabilityZones={availabilityZones} disk={disk} snapshots={diskSnapshots} /> : null}
        {activeTab === "backups" ? <BackupsTab backups={backupsResult?.data.backups ?? []} disk={disk} vaults={backupsResult?.data.vaults ?? []} /> : null}
        {activeTab === "monitoring" ? <MonitoringTab disk={disk} monitoring={monitoringResult?.data ?? null} /> : null}
        {activeTab === "tags" ? <TagsTab disk={disk} /> : null}
        {activeTab === "activity" ? <ActivityTab traces={activityResult?.data ?? []} /> : null}
      </ConsoleMain>
    </ConsoleShell>
  );
}
