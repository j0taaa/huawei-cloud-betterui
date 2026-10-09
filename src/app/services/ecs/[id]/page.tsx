import { CloudErrorPage } from "@/components/cloud-error";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Clock3,
  Copy,
  Cpu,
  Eye,
  Globe2,
  HardDrive,
  ImageIcon,
  KeyRound,
  MapPin,
  MoreHorizontal,
  Network,
  ReceiptText,
  Server,
  ShieldCheck,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleBackLink,
  ConsoleActionGroup,
  ConsoleCallout,
  ConsoleCatalogCard,
  ConsoleFloatingMenuPanel,
  ConsoleMenuLink,
  ConsoleInsetPanel,
  ConsoleMutedText,
  ConsolePanel,
  ConsolePanelActionBar,
  ConsolePanelGrid,
  ConsolePill,
  ConsoleResponsiveGrid,
  ConsoleStatCardGrid,
  ConsoleSurface,
  DataFreshnessText,
  DetailItem,
  DetailSection,
  EmptyStatePanel,
  KeyValueGrid,
  ResourceIdentity,
  SimpleTable,
  SignalCard,
  StatusBadge,
  TableEmptyText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { EcsInstanceActions } from "@/components/ecs-instance-actions";
import { EcsMonitoringChart } from "@/components/ecs-monitoring-chart";
import {
  CreateSnapshotButton,
  DeleteSnapshotButton,
} from "@/components/ecs-snapshot-actions";
import { MonthlyResourceCostCard } from "@/components/monthly-resource-cost-card";
import {
  getEcsInstance,
  getEcsMonitoring,
  getEcsSnapshots,
  type EcsInstance,
  type EcsMonitoring,
  type EvsSnapshot,
  withCloudResult,
} from "@/lib/huawei-cloud";
import { LocalDateTime } from "@/components/local-date-time";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "monitoring", label: "Monitoring" },
  { id: "disks", label: "Disks" },
  { id: "nics", label: "NICs" },
  { id: "snapshots", label: "Snapshots" },
  { id: "tags", label: "Tags" },
] as const;
type EcsTab = (typeof tabs)[number]["id"];

function displayStatus(status: string) {
  if (status === "ACTIVE") {
    return "Running";
  }

  if (status === "SHUTOFF") {
    return "Stopped";
  }

  return status;
}

function isEcsTab(value: string | undefined): value is EcsTab {
  return tabs.some((tab) => tab.id === value);
}

function SecurityOverview({ instance }: { instance: EcsInstance }) {
  const primaryGroup = instance.securityGroups[0];
  const groupHref = primaryGroup
    ? `/services/network/security-groups/${primaryGroup.id}`
    : "/services/network";

  return (
    <DetailSection icon={<ShieldCheck className="size-4" />} title="Security">
      <DetailItem
        href={primaryGroup ? groupHref : undefined}
        icon={<ShieldCheck className="size-4" />}
        label="Security Groups"
        subValue={primaryGroup?.id !== primaryGroup?.name ? primaryGroup?.id : undefined}
        value={primaryGroup?.name ?? "No security group found"}
      />
      {instance.securityGroups.length > 1 ? (
        <div className="mt-4 grid gap-2">
          {instance.securityGroups.slice(1).map((group) => (
            <Link
              className="rounded-lg bg-[#f7f9fc] px-4 py-3 text-sm font-bold text-[#344054] hover:text-[#2563eb]"
              href={`/services/network/security-groups/${group.id}`}
              key={group.id}
            >
              {group.name}
            </Link>
          ))}
        </div>
      ) : null}
      <Link
        className="mt-4 inline-flex items-center gap-2 text-sm font-black text-[#2563eb]"
        href={groupHref}
      >
        <Eye className="size-4" />
        View all rules
      </Link>
    </DetailSection>
  );
}

function EcsMoreMenu({ instance }: { instance: EcsInstance }) {
  const systemDiskId = instance.systemDisk?.id ?? instance.attachedDiskIds?.[0];
  const primaryGroup = instance.securityGroups[0];
  const items = [
    {
      href: "/services/ecs",
      icon: <Server className="size-4" />,
      label: "View all ECS instances",
    },
    ...(systemDiskId
      ? [
          {
            href: `/services/evs/${systemDiskId}`,
            icon: <HardDrive className="size-4" />,
            label: "Open system disk",
          },
        ]
      : []),
    {
      href: primaryGroup
        ? `/services/network/security-groups/${primaryGroup.id}`
        : "/services/network",
      icon: <ShieldCheck className="size-4" />,
      label: "View security rules",
    },
  ];

  return (
    <details className="group relative">
      <summary
        aria-label="More ECS actions"
        className="grid size-11 cursor-pointer list-none place-items-center rounded-lg border border-[#d9e0eb] bg-white shadow-sm hover:bg-[#f8fafc] group-open:bg-[#eef4ff] group-open:text-[#2563eb] [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="size-5" />
      </summary>
      <ConsoleFloatingMenuPanel className="absolute right-0 top-13 z-30 grid w-56 gap-1">
        {items.map((item) => (
          <ConsoleMenuLink href={item.href} key={item.label}>
            {item.icon}
            {item.label}
          </ConsoleMenuLink>
        ))}
      </ConsoleFloatingMenuPanel>
    </details>
  );
}

function OverviewDetails({ instance }: { instance: EcsInstance }) {
  const imageName = instance.imageName ?? instance.image;
  const imageId = instance.imageId ?? instance.image;
  const systemDisk = instance.systemDisk;
  const systemDiskId = systemDisk?.id ?? instance.attachedDiskIds?.[0];

  return (
    <ConsoleSurface className="p-6 shadow-[0_18px_48px_rgba(16,24,40,0.07)]">
      <div className="grid gap-8 xl:grid-cols-[1.1fr_1fr_1.2fr_0.9fr]">
        <div className="grid gap-6 border-[#e4e9f2] xl:border-r xl:pr-8">
          <DetailItem
            icon={<Server className="size-4" />}
            label="Status"
            subValue={
              instance.taskState !== "-"
                ? `Task: ${instance.taskState}`
                : instance.vmState !== "-"
                  ? `VM: ${instance.vmState}`
                  : undefined
            }
            value={displayStatus(instance.status)}
          />
          <DetailItem
            icon={<Cpu className="size-4" />}
            label="Flavor"
            subValue={instance.flavorId !== instance.flavor ? instance.flavorId : undefined}
            value={instance.flavor}
          />
          <DetailItem
            icon={<MapPin className="size-4" />}
            label="Availability Zone"
            value={instance.availabilityZone}
          />
          <DetailItem
            icon={<CalendarDays className="size-4" />}
            label="Created"
            value={<LocalDateTime value={instance.createdAt} />}
          />
          <DetailItem
            icon={<Clock3 className="size-4" />}
            label="Updated"
            value={
              instance.updatedAt !== "-" ? (
                <LocalDateTime value={instance.updatedAt} />
              ) : (
                "-"
              )
            }
          />
        </div>

        <div className="grid gap-6 border-[#e4e9f2] xl:border-r xl:pr-8">
          <DetailItem
            icon={<Network className="size-4" />}
            label="Private IP"
            value={instance.privateIp}
          />
          <DetailItem
            icon={<Globe2 className="size-4" />}
            label="Public IP"
            value={instance.publicIp}
          />
          <DetailItem
            icon={<Network className="size-4" />}
            label="NICs"
            value={`${instance.addresses.length} addresses`}
          />
          <DetailItem
            icon={<ShieldCheck className="size-4" />}
            label="Security Groups"
            value={`${instance.securityGroups.length} groups`}
          />
        </div>

        <div className="grid gap-6 border-[#e4e9f2] xl:border-r xl:pr-8">
          <DetailItem
            icon={<ImageIcon className="size-4" />}
            label="Image"
            subValue={imageId !== imageName ? imageId : undefined}
            value={imageName}
          />
          <DetailItem
            href={systemDiskId ? `/services/evs/${systemDiskId}` : undefined}
            icon={<HardDrive className="size-4" />}
            label="System Disk"
            subValue={
              systemDisk
                ? `${systemDisk.id} | ${systemDisk.size} | ${systemDisk.type}`
                : systemDiskId
                  ? systemDiskId
                  : "Disk details are loaded from EVS when available."
            }
            value={systemDisk?.name ?? systemDiskId ?? "EVS system disk"}
          />
          <DetailItem
            icon={<KeyRound className="size-4" />}
            label="Key Pair"
            value={instance.keyName}
          />
          <DetailItem
            icon={<ReceiptText className="size-4" />}
            label="Charging Mode"
            value={instance.chargingMode}
          />
        </div>

        <div className="grid content-start gap-3">
          <SignalCard
            icon={<Activity className="size-4" />}
            label="Power State"
            tone={instance.status === "ACTIVE" ? "good" : "neutral"}
            value={instance.powerState}
          />
          <SignalCard
            icon={<Globe2 className="size-4" />}
            label="External Access"
            tone={instance.publicIp !== "-" ? "warn" : "neutral"}
            value={instance.publicIp !== "-" ? "EIP attached" : "Private only"}
          />
        </div>
      </div>
    </ConsoleSurface>
  );
}

function MonitoringDashboard({ monitoring }: { monitoring: EcsMonitoring | null }) {
  if (!monitoring) {
    return (
      <DetailSection icon={<Activity className="size-4" />} title="Monitoring">
        <ConsoleMutedText weight="semibold">
          Monitoring data is unavailable because the ECS instance could not be found.
        </ConsoleMutedText>
      </DetailSection>
    );
  }

  return (
    <ConsolePanelGrid className="gap-5">
      {monitoring.metrics.map((metric) => (
            <ConsoleSurface
              actions={
                <ConsolePill className="px-3" tone="info">
                  {metric.namespace} · {metric.metricName}
                </ConsolePill>
              }
              className="shadow-[0_18px_48px_rgba(16,24,40,0.07)]"
              description={`Region ${monitoring.region} · project ${monitoring.projectId}`}
              key={metric.metricName}
              title={metric.label}
            >

              {metric.datapoints.length ? (
                <EcsMonitoringChart datapoints={metric.datapoints} unit={metric.unit} />
              ) : (
                <div className="p-6">
                  <ConsoleInsetPanel
                    className="p-8 text-center"
                    dashed
                    title="No Cloud Eye datapoints returned for this metric."
                  >
                    The instance may not have agent metrics enabled yet, or this account may not have CES metric permissions.
                  </ConsoleInsetPanel>
                </div>
              )}
            </ConsoleSurface>
          ))}
    </ConsolePanelGrid>
  );
}

function DisksTab({ instance }: { instance: EcsInstance }) {
  const diskIds = Array.from(
    new Set([
      ...(instance.systemDisk?.id ? [instance.systemDisk.id] : []),
      ...instance.attachedDiskIds,
    ]),
  );

  if (!diskIds.length) {
    return (
      <EmptyStatePanel title="No disks found">
        Huawei did not return attached EVS disk ids for this ECS instance.
      </EmptyStatePanel>
    );
  }

  return (
    <ConsolePanel
      description="Attached EVS disks for this ECS instance."
      title="Disks"
    >
      <SimpleTable
        columns={[
          { header: "Name" },
          { header: "Role" },
          { header: "Size" },
          { header: "Type" },
          { header: "Status" },
        ]}
        emptyState={<TableEmptyText>No disks found.</TableEmptyText>}
        minWidthClassName="min-w-[760px]"
        rows={diskIds.map((diskId) => {
          const isSystemDisk = diskId === instance.systemDisk?.id;

          return {
            cells: [
              <ResourceIdentity
                href={`/services/evs/${diskId}`}
                id={diskId}
                key="name"
                name={isSystemDisk ? instance.systemDisk?.name : diskId}
              />,
              isSystemDisk ? "System disk" : "Data disk",
              isSystemDisk ? instance.systemDisk?.size : "Open disk details",
              isSystemDisk ? instance.systemDisk?.type : "-",
              <StatusBadge
                key="status"
                status={isSystemDisk ? instance.systemDisk?.status : "Attached"}
              />,
            ],
            key: diskId,
          };
        })}
      />
    </ConsolePanel>
  );
}

function NicsTab({ instance }: { instance: EcsInstance }) {
  if (!instance.addresses.length) {
    return (
      <EmptyStatePanel title="No NIC details">
        Huawei did not return address or NIC metadata for this ECS instance.
      </EmptyStatePanel>
    );
  }

  return (
    <ConsoleResponsiveGrid className="gap-5" variant="xl-1-0.8">
      <ConsolePanel icon={Network} title="Network interfaces">
        <SimpleTable
          columns={[
            { header: "Network" },
            { header: "IP address" },
            { header: "Type" },
            { header: "Version" },
            { header: "MAC" },
          ]}
          emptyState={<TableEmptyText>No NIC details returned.</TableEmptyText>}
          minWidthClassName="min-w-[680px]"
          rows={instance.addresses.map((address) => ({
            cells: [
              address.network,
              address.ip,
              address.type,
              address.version,
              address.macAddress,
            ],
            key: `${address.network}-${address.ip}-${address.macAddress}`,
          }))}
        />
      </ConsolePanel>
      <ConsolePanel icon={ShieldCheck} title="Attached security groups">
        {instance.securityGroups.length ? (
          <div className="grid gap-3 p-5">
            {instance.securityGroups.map((group) => (
              <ConsoleCatalogCard
                href={`/services/network/security-groups/${group.id}`}
                key={group.id}
              >
                <p className="font-black text-[#2563eb]">{group.name}</p>
                <p className="mt-1 text-xs font-semibold text-[#667085]">{group.id}</p>
              </ConsoleCatalogCard>
            ))}
          </div>
        ) : (
          <ConsoleMutedText className="p-5" weight="semibold">No security groups returned for this NIC.</ConsoleMutedText>
        )}
      </ConsolePanel>
    </ConsoleResponsiveGrid>
  );
}

function SnapshotTargets({ instance }: { instance: EcsInstance }) {
  const diskIds = Array.from(
    new Set([
      ...(instance.systemDisk?.id ? [instance.systemDisk.id] : []),
      ...instance.attachedDiskIds,
    ]),
  );

  return diskIds.map((diskId) => ({
    diskId,
    label:
      diskId === instance.systemDisk?.id
        ? `${instance.systemDisk.name} (system disk)`
        : `${diskId} (data disk)`,
  }));
}

function SnapshotsTab({
  instance,
  snapshots,
}: {
  instance: EcsInstance;
  snapshots: EvsSnapshot[] | null;
}) {
  const snapshotTargets = SnapshotTargets({ instance });

  if (!snapshots) {
    return (
      <section className="grid gap-5">
        <div className="flex justify-end">
          <CreateSnapshotButton
            ecsId={instance.id}
            projectId={instance.projectId}
            targets={snapshotTargets}
          />
        </div>
        <EmptyStatePanel title="Snapshots unavailable">
          Snapshot data could not be loaded for this ECS instance.
        </EmptyStatePanel>
      </section>
    );
  }

  if (!snapshots.length) {
    return (
      <section className="grid gap-5">
        <div className="flex justify-end">
          <CreateSnapshotButton
            ecsId={instance.id}
            projectId={instance.projectId}
            targets={snapshotTargets}
          />
        </div>
        <EmptyStatePanel title="No snapshots found">
          No EVS snapshots were found for this ECS instance&apos;s attached disks.
        </EmptyStatePanel>
      </section>
    );
  }

  return (
    <ConsolePanel
      description="EVS snapshots for disks attached to this ECS instance."
      title="Snapshots"
    >
      <ConsolePanelActionBar
        actions={
          <CreateSnapshotButton
            ecsId={instance.id}
            projectId={instance.projectId}
            targets={snapshotTargets}
          />
        }
      />
      <SimpleTable
        columns={[
          { header: "Name" },
          { header: "Status" },
          { header: "Source disk" },
          { header: "Size" },
          { header: "Created" },
          { header: "Description" },
          { header: "Actions" },
        ]}
        emptyState={<TableEmptyText>No snapshots found.</TableEmptyText>}
        minWidthClassName="min-w-[980px]"
        rows={snapshots.map((snapshot) => ({
          cells: [
            <ResourceIdentity id={snapshot.id} key="name" name={snapshot.name} />,
            <StatusBadge key="status" status={snapshot.status} />,
            <ResourceIdentity
              href={`/services/evs/${snapshot.diskId}`}
              key="disk"
              name={snapshot.diskId}
            />,
            snapshot.size,
            <LocalDateTime key="created" value={snapshot.createdAt} />,
            snapshot.description || "-",
            (
              <DeleteSnapshotButton
                ecsId={instance.id}
                key="actions"
                projectId={snapshot.projectId}
                snapshotId={snapshot.id}
                snapshotName={snapshot.name}
              />
            ),
          ],
          key: snapshot.id,
        }))}
      />
    </ConsolePanel>
  );
}

function TagsTab({ instance }: { instance: EcsInstance }) {
  const rows = instance.tags.length ? instance.tags : instance.metadata;

  if (rows.length) {
    return (
      <ConsolePanel
        description={
          instance.tags.length
            ? "Resource tags returned by ECS."
            : "ECS metadata returned in the server detail payload."
        }
        title={instance.tags.length ? "Tags" : "Metadata"}
      >
        <KeyValueGrid
          emptyState="No tags or metadata returned."
          items={rows}
        />
      </ConsolePanel>
    );
  }

  return (
    <EmptyStatePanel title="No tags">
      Huawei did not return tags for this ECS instance in the current ECS detail payload.
    </EmptyStatePanel>
  );
}

function OverviewTab({ instance }: { instance: EcsInstance }) {
  return (
    <>
      <EcsOverviewSignals instance={instance} />
      <OverviewDetails instance={instance} />
      <ConsoleResponsiveGrid className="gap-5" variant="xl-1.15-0.85">
        <DetailSection icon={<Network className="size-4" />} title="Network">
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            <DetailItem icon={<Network className="size-4" />} label="Networks" value={Array.from(new Set(instance.addresses.map((address) => address.network))).join(", ") || "-"} />
            <DetailItem icon={<Globe2 className="size-4" />} label="Public exposure" value={instance.publicIp !== "-" ? "EIP attached" : "No public IP"} />
            <DetailItem icon={<Globe2 className="size-4" />} label="EIP" value={instance.publicIp} />
            <DetailItem icon={<Network className="size-4" />} label="Address count" value={instance.addresses.length} />
            <DetailItem
              icon={<Globe2 className="size-4" />}
              label="Primary IP"
              subValue={instance.publicIp !== "-" ? `${instance.publicIp} (Public)` : undefined}
              value={`${instance.privateIp} (Private)`}
            />
            <DetailItem icon={<MapPin className="size-4" />} label="Region" value={instance.region} />
          </div>
        </DetailSection>
        <SecurityOverview instance={instance} />
      </ConsoleResponsiveGrid>
      <TagsTab instance={instance} />
    </>
  );
}

function EcsOverviewSignals({ instance }: { instance: EcsInstance }) {
  const isHealthy = instance.status === "ACTIVE";
  const hasTask = instance.taskState !== "-";

  return (
    <ConsoleStatCardGrid columns={5}>
      <MonthlyResourceCostCard
        region={instance.region}
        resourceId={instance.id}
      />
      <SignalCard
        icon={<Server className="size-4" />}
        label="Lifecycle"
        tone={isHealthy ? "good" : hasTask ? "warn" : "neutral"}
        value={hasTask ? instance.taskState : displayStatus(instance.status)}
      />
      <SignalCard
        icon={<Cpu className="size-4" />}
        label="Specification"
        value={instance.flavor}
      />
      <SignalCard
        icon={<Network className="size-4" />}
        label="NIC Addresses"
        value={instance.addresses.length}
      />
      <SignalCard
        icon={<AlertTriangle className="size-4" />}
        label="Internet Path"
        tone={instance.publicIp !== "-" ? "warn" : "neutral"}
        value={instance.publicIp !== "-" ? instance.publicIp : "Private only"}
      />
    </ConsoleStatCardGrid>
  );
}

function EcsTabContent({
  activeTab,
  instance,
  monitoring,
  monitoringError,
  snapshots,
  snapshotsError,
}: {
  activeTab: EcsTab;
  instance: EcsInstance;
  monitoring: EcsMonitoring | null;
  monitoringError?: string | null;
  snapshots: EvsSnapshot[] | null;
  snapshotsError?: string | null;
}) {
  if (activeTab === "monitoring") {
    return (
      <>
        {monitoringError ? (
          <ConsoleCallout>{monitoringError}</ConsoleCallout>
        ) : null}
        <MonitoringDashboard monitoring={monitoring} />
      </>
    );
  }

  if (activeTab === "disks") {
    return <DisksTab instance={instance} />;
  }

  if (activeTab === "nics") {
    return <NicsTab instance={instance} />;
  }

  if (activeTab === "snapshots") {
    return (
      <>
        {snapshotsError ? (
          <ConsoleCallout>{snapshotsError}</ConsoleCallout>
        ) : null}
        <SnapshotsTab instance={instance} snapshots={snapshots} />
      </>
    );
  }

  if (activeTab === "tags") {
    return <TagsTab instance={instance} />;
  }

  return <OverviewTab instance={instance} />;
}

export default async function EcsInstancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const activeTab = isEcsTab(query.tab) ? query.tab : "overview";
  const result = await withCloudResult(
    null,
    (session) => getEcsInstance(session, id),
    `ecs-instance-v2:${id}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Compute" backHref="/services/ecs" error={result.error} />;
  const monitoringResult =
    activeTab === "monitoring"
      ? await withCloudResult(
          null,
          (session) => getEcsMonitoring(session, id),
          `ecs-monitoring-v3:${id}`,
        )
      : null;
  const snapshotsResult =
    activeTab === "snapshots"
      ? await withCloudResult(
          null,
          (session) => getEcsSnapshots(session, id),
          `ecs-snapshots:${id}`,
        )
      : null;
  const instance = result.data;

  if (!instance) {
    notFound();
  }

  const isHealthy = instance.status === "ACTIVE";

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator
        show={
          result.isRefreshing ||
          (monitoringResult?.isRefreshing ?? false) ||
          (snapshotsResult?.isRefreshing ?? false)
        }
      />
      <main className="grid gap-5 bg-[#f4f7fb] p-4 lg:p-8">
        <ConsoleBackLink className="font-black" href="/services/ecs">
          Back to ECS
        </ConsoleBackLink>

        <section className="relative overflow-visible rounded-2xl border border-[#e4e9f2] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.07)]">
          <div className="flex flex-col gap-6 p-6 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-5">
              <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#eef4ff] to-[#e7f0ff] text-[#2563eb] shadow-inner">
                <Server className="size-9" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="break-words text-3xl font-black tracking-tight text-[#101828]">
                    {instance.name}
                  </h1>
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-[#344054]">
                    <span
                      className={`size-2.5 rounded-full ${
                        isHealthy
                          ? "bg-[#20c997] shadow-[0_0_0_4px_rgba(32,201,151,0.14)]"
                          : "bg-[#98a2b3] shadow-[0_0_0_4px_rgba(152,162,179,0.16)]"
                      }`}
                    />
                    {displayStatus(instance.status)}
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-2 break-words text-sm font-semibold text-[#475467]">
                  {instance.id}
                  <Copy className="size-3.5 text-[#667085]" />
                </p>
                <p className="mt-1 text-xs font-bold text-[#98a2b3]">
                  <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
                </p>
              </div>
            </div>
            <ConsoleActionGroup>
              <EcsInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
              <EcsMoreMenu instance={instance} />
            </ConsoleActionGroup>
          </div>

          <nav className="flex gap-6 overflow-x-auto border-t border-[#eef2f7] px-6">
            {tabs.map((tab) => (
              <Link
                className={`relative h-14 whitespace-nowrap px-1 text-sm font-black ${
                  tab.id === activeTab ? "text-[#2563eb]" : "text-[#667085]"
                }`}
                href={tab.id === "overview" ? `/services/ecs/${id}` : `/services/ecs/${id}?tab=${tab.id}`}
                key={tab.id}
              >
                <span className="flex h-full items-center">{tab.label}</span>
                {tab.id === activeTab ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#2563eb]" />
                ) : null}
              </Link>
            ))}
          </nav>
        </section>

        <EcsTabContent
          activeTab={activeTab}
          instance={instance}
          monitoring={monitoringResult?.data ?? null}
          monitoringError={monitoringResult?.error}
          snapshots={snapshotsResult?.data ?? null}
          snapshotsError={snapshotsResult?.error}
        />
      </main>
    </ConsoleShell>
  );
}
