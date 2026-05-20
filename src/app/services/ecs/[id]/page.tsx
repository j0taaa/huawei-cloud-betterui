import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Copy,
  Eye,
  Globe2,
  HardDrive,
  ImageIcon,
  MapPin,
  MoreHorizontal,
  Network,
  Server,
  ShieldCheck,
  Tag,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { EcsInstanceActions } from "@/components/ecs-instance-actions";
import { EcsMonitoringChart } from "@/components/ecs-monitoring-chart";
import {
  CreateSnapshotButton,
  DeleteSnapshotButton,
} from "@/components/ecs-snapshot-actions";
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

function DetailRow({
  href,
  icon,
  label,
  value,
  subValue,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  subValue?: React.ReactNode;
  value: React.ReactNode;
}) {
  const valueContent = href ? (
    <Link className="text-[#2563eb] hover:underline" href={href}>
      {value}
    </Link>
  ) : (
    value
  );

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#eef4ff] text-[#2563eb]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-black text-[#667085]">{label}</p>
        <p className="mt-1 flex items-center gap-2 break-words text-sm font-black text-[#101828]">
          {valueContent}
          {value !== "-" ? <Copy className="size-3.5 text-[#667085]" /> : null}
        </p>
        {subValue ? (
          <p className="mt-1 break-words text-xs font-semibold text-[#667085]">
            {subValue}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SectionCard({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-[#e4e9f2] bg-white p-6 shadow-[0_18px_48px_rgba(16,24,40,0.07)]">
      <div className="mb-5 flex items-center gap-2">
        <div className="grid size-7 place-items-center rounded-lg bg-[#f4f7fb] text-[#101828]">
          {icon}
        </div>
        <h2 className="text-lg font-black tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SecurityRule({
  cidr,
  name,
}: {
  cidr: string;
  name: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-4 rounded-lg bg-[#f7f9fc] px-4 py-3 text-sm font-bold text-[#344054]">
      <span>{name}</span>
      <span>IPv4</span>
      <span>{cidr}</span>
    </div>
  );
}

function SecurityOverview({ instance }: { instance: EcsInstance }) {
  const primaryGroup = instance.securityGroups[0];
  const groupHref = primaryGroup
    ? `/services/network/security-groups/${primaryGroup.id}`
    : "/services/network";

  return (
    <SectionCard icon={<ShieldCheck className="size-4" />} title="Security">
      <DetailRow
        href={primaryGroup ? groupHref : undefined}
        icon={<ShieldCheck className="size-4" />}
        label="Security Groups"
        subValue={primaryGroup?.id !== primaryGroup?.name ? primaryGroup?.id : undefined}
        value={primaryGroup?.name ?? "No security group found"}
      />
      <div className="mt-4 grid gap-2">
        <SecurityRule cidr="Any" name="Allow ICMP" />
        <SecurityRule cidr="0.0.0.0/0" name="Allow SSH (22)" />
        <SecurityRule cidr="0.0.0.0/0" name="Allow RDP (3389)" />
      </div>
      <Link
        className="mt-4 inline-flex items-center gap-2 text-sm font-black text-[#2563eb]"
        href={groupHref}
      >
        <Eye className="size-4" />
        View all rules
      </Link>
    </SectionCard>
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
      <div className="absolute right-0 top-13 z-30 w-56 overflow-hidden rounded-xl border border-[#d9e0eb] bg-white py-2 shadow-[0_18px_48px_rgba(16,24,40,0.16)]">
        {items.map((item) => (
          <Link
            className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-[#344054] hover:bg-[#f4f7fb] hover:text-[#2563eb]"
            href={item.href}
            key={item.label}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

function ServerIllustration() {
  return (
    <div className="relative h-full min-h-44 overflow-hidden rounded-xl bg-gradient-to-br from-[#f7fbff] via-[#eef5ff] to-[#f8fbff]">
      <div className="absolute left-8 top-12 h-8 w-16 rounded-full bg-[#dceaff] blur-sm" />
      <div className="absolute right-8 top-8 h-8 w-16 rounded-full bg-[#e5efff] blur-sm" />
      <div className="absolute inset-x-0 bottom-8 mx-auto h-16 w-40 rotate-45 rounded-2xl bg-[#dbe8ff] opacity-70" />
      <div className="absolute left-1/2 top-12 w-28 -translate-x-1/2 rounded-2xl bg-white/70 p-2 shadow-[0_18px_60px_rgba(37,99,235,0.22)]">
        {["top", "middle", "bottom"].map((layer) => (
          <div
            className="mb-2 h-9 rounded-xl bg-gradient-to-r from-[#6aa6ff] via-[#3b82f6] to-[#2563eb] last:mb-0"
            key={layer}
          />
        ))}
      </div>
    </div>
  );
}

function OverviewDetails({ instance }: { instance: EcsInstance }) {
  const imageName = instance.imageName ?? instance.image;
  const imageId = instance.imageId ?? instance.image;
  const systemDisk = instance.systemDisk;
  const systemDiskId = systemDisk?.id ?? instance.attachedDiskIds?.[0];

  return (
    <section className="rounded-2xl border border-[#e4e9f2] bg-white p-6 shadow-[0_18px_48px_rgba(16,24,40,0.07)]">
      <div className="grid gap-8 xl:grid-cols-[1.1fr_1fr_1.2fr_0.9fr]">
        <div className="grid gap-6 border-[#e4e9f2] xl:border-r xl:pr-8">
          <DetailRow
            icon={<Server className="size-4" />}
            label="Status"
            value={displayStatus(instance.status)}
          />
          <DetailRow
            icon={<HardDrive className="size-4" />}
            label="Flavor"
            value={instance.flavor}
          />
          <DetailRow
            icon={<MapPin className="size-4" />}
            label="Availability Zone"
            value={instance.availabilityZone}
          />
          <DetailRow
            icon={<CalendarDays className="size-4" />}
            label="Created"
            value={<LocalDateTime value={instance.createdAt} />}
          />
        </div>

        <div className="grid gap-6 border-[#e4e9f2] xl:border-r xl:pr-8">
          <DetailRow
            icon={<Network className="size-4" />}
            label="Private IP"
            value={instance.privateIp}
          />
          <DetailRow
            icon={<Globe2 className="size-4" />}
            label="Public IP"
            value={instance.publicIp}
          />
          <DetailRow
            icon={<Globe2 className="size-4" />}
            label="Domain Name"
            value="-"
          />
        </div>

        <div className="grid gap-6 border-[#e4e9f2] xl:border-r xl:pr-8">
          <DetailRow
            icon={<ImageIcon className="size-4" />}
            label="Image"
            subValue={imageId !== imageName ? imageId : undefined}
            value={imageName}
          />
          <DetailRow
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
        </div>

        <ServerIllustration />
      </div>
    </section>
  );
}

function MonitoringDashboard({ monitoring }: { monitoring: EcsMonitoring | null }) {
  if (!monitoring) {
    return (
      <SectionCard icon={<Activity className="size-4" />} title="Monitoring">
        <p className="text-sm font-semibold text-[#667085]">
          Monitoring data is unavailable because the ECS instance could not be found.
        </p>
      </SectionCard>
    );
  }

  return (
    <section className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-2">
        {monitoring.metrics.map((metric) => (
            <article
              className="rounded-2xl border border-[#e4e9f2] bg-white p-6 shadow-[0_18px_48px_rgba(16,24,40,0.07)]"
              key={metric.metricName}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black tracking-tight">{metric.label}</h2>
                  <p className="mt-1 text-sm font-semibold text-[#667085]">
                    Region {monitoring.region} · project {monitoring.projectId}
                  </p>
                </div>
                <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-xs font-black text-[#2563eb]">
                  {metric.namespace} · {metric.metricName}
                </span>
              </div>

              {metric.datapoints.length ? (
                <EcsMonitoringChart datapoints={metric.datapoints} unit={metric.unit} />
              ) : (
                <div className="mt-6 rounded-xl border border-dashed border-[#d9e0eb] bg-[#fbfcfe] p-8 text-center">
                  <p className="text-sm font-black text-[#344054]">
                    No Cloud Eye datapoints returned for this metric.
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#667085]">
                    The instance may not have agent metrics enabled yet, or this account may not have CES metric permissions.
                  </p>
                </div>
              )}
            </article>
          ))}
      </section>
    </section>
  );
}

function EmptyTabState({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-[#c8d3e3] bg-white p-10 text-center shadow-[0_18px_48px_rgba(16,24,40,0.05)]">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#eef4ff] text-[#2563eb]">
        {icon}
      </div>
      <h2 className="mt-4 text-lg font-black tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold text-[#667085]">
        {children}
      </p>
    </section>
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
      <EmptyTabState icon={<HardDrive className="size-5" />} title="No disks found">
        Huawei did not return attached EVS disk ids for this ECS instance.
      </EmptyTabState>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e4e9f2] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.07)]">
      <div className="border-b border-[#eef2f7] p-5">
        <h2 className="text-lg font-black tracking-tight">Disks</h2>
        <p className="mt-1 text-sm font-semibold text-[#667085]">
          Attached EVS disks for this ECS instance.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Size</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef2f7]">
            {diskIds.map((diskId) => {
              const isSystemDisk = diskId === instance.systemDisk?.id;

              return (
                <tr className="hover:bg-[#fbfcfe]" key={diskId}>
                  <td className="px-5 py-4">
                    <Link className="font-black text-[#2563eb]" href={`/services/evs/${diskId}`}>
                      {isSystemDisk ? instance.systemDisk?.name : diskId}
                    </Link>
                    <p className="mt-1 text-xs font-semibold text-[#98a2b3]">{diskId}</p>
                  </td>
                  <td className="px-5 py-4 font-semibold">
                    {isSystemDisk ? "System disk" : "Data disk"}
                  </td>
                  <td className="px-5 py-4 font-semibold">
                    {isSystemDisk ? instance.systemDisk?.size : "Open disk details"}
                  </td>
                  <td className="px-5 py-4 font-semibold">
                    {isSystemDisk ? instance.systemDisk?.type : "-"}
                  </td>
                  <td className="px-5 py-4 font-semibold">
                    {isSystemDisk ? instance.systemDisk?.status : "Attached"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NicsTab({ instance }: { instance: EcsInstance }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
      <SectionCard icon={<Network className="size-4" />} title="Network interfaces">
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          <DetailRow icon={<Network className="size-4" />} label="Primary private IP" value={instance.privateIp} />
          <DetailRow icon={<Globe2 className="size-4" />} label="Public IP / EIP" value={instance.publicIp} />
          <DetailRow icon={<MapPin className="size-4" />} label="Availability Zone" value={instance.availabilityZone} />
          <DetailRow icon={<Server className="size-4" />} label="Interface" value="Primary NIC" />
        </div>
      </SectionCard>
      <SectionCard icon={<ShieldCheck className="size-4" />} title="Attached security groups">
        {instance.securityGroups.length ? (
          <div className="grid gap-3">
            {instance.securityGroups.map((group) => (
              <Link
                className="rounded-xl border border-[#e4e9f2] bg-[#fbfcfe] p-4 transition hover:border-[#2563eb] hover:bg-[#eef4ff]"
                href={`/services/network/security-groups/${group.id}`}
                key={group.id}
              >
                <p className="font-black text-[#2563eb]">{group.name}</p>
                <p className="mt-1 text-xs font-semibold text-[#667085]">{group.id}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm font-semibold text-[#667085]">No security groups returned for this NIC.</p>
        )}
      </SectionCard>
    </section>
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
        <EmptyTabState icon={<HardDrive className="size-5" />} title="Snapshots unavailable">
          Snapshot data could not be loaded for this ECS instance.
        </EmptyTabState>
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
        <EmptyTabState icon={<HardDrive className="size-5" />} title="No snapshots found">
          No EVS snapshots were found for this ECS instance&apos;s attached disks.
        </EmptyTabState>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e4e9f2] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.07)]">
      <div className="flex flex-col gap-4 border-b border-[#eef2f7] p-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-black tracking-tight">Snapshots</h2>
          <p className="mt-1 text-sm font-semibold text-[#667085]">
            EVS snapshots for disks attached to this ECS instance.
          </p>
        </div>
        <CreateSnapshotButton
          ecsId={instance.id}
          projectId={instance.projectId}
          targets={snapshotTargets}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Source disk</th>
              <th className="px-5 py-3">Size</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3">Description</th>
              <th className="px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef2f7]">
            {snapshots.map((snapshot) => (
              <tr className="hover:bg-[#fbfcfe]" key={snapshot.id}>
                <td className="px-5 py-4">
                  <p className="font-black text-[#101828]">{snapshot.name}</p>
                  <p className="mt-1 text-xs font-semibold text-[#98a2b3]">{snapshot.id}</p>
                </td>
                <td className="px-5 py-4 font-semibold">{snapshot.status}</td>
                <td className="px-5 py-4">
                  <Link className="font-bold text-[#2563eb] hover:underline" href={`/services/evs/${snapshot.diskId}`}>
                    {snapshot.diskId}
                  </Link>
                </td>
                <td className="px-5 py-4 font-semibold">{snapshot.size}</td>
                <td className="px-5 py-4 font-semibold">
                  <LocalDateTime value={snapshot.createdAt} />
                </td>
                <td className="px-5 py-4 font-semibold text-[#667085]">
                  {snapshot.description || "-"}
                </td>
                <td className="px-5 py-4">
                  <DeleteSnapshotButton
                    ecsId={instance.id}
                    projectId={snapshot.projectId}
                    snapshotId={snapshot.id}
                    snapshotName={snapshot.name}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TagsTab() {
  return (
    <EmptyTabState icon={<Tag className="size-5" />} title="No tags">
      Huawei did not return tags for this ECS instance in the current ECS detail payload.
    </EmptyTabState>
  );
}

function OverviewTab({ instance }: { instance: EcsInstance }) {
  return (
    <>
      <OverviewDetails instance={instance} />
      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard icon={<Network className="size-4" />} title="Network">
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            <DetailRow icon={<Network className="size-4" />} label="VPC" value="vpc-default" />
            <DetailRow icon={<Globe2 className="size-4" />} label="Bandwidth" value="Pay-per-use" />
            <DetailRow icon={<Network className="size-4" />} label="Subnet" value="subnet-default" />
            <DetailRow icon={<Globe2 className="size-4" />} label="EIP" value={instance.publicIp} />
            <DetailRow icon={<Network className="size-4" />} label="Network Interface" value="Primary NIC" />
            <DetailRow
              icon={<Globe2 className="size-4" />}
              label="Primary IP"
              subValue={`${instance.publicIp} (Public)`}
              value={`${instance.privateIp} (Private)`}
            />
          </div>
        </SectionCard>
        <SecurityOverview instance={instance} />
      </section>
      <TagsTab />
    </>
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
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {monitoringError}
          </section>
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
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {snapshotsError}
          </section>
        ) : null}
        <SnapshotsTab instance={instance} snapshots={snapshots} />
      </>
    );
  }

  if (activeTab === "tags") {
    return <TagsTab />;
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
        <Link
          className="inline-flex w-fit items-center gap-2 text-sm font-black text-[#2563eb]"
          href="/services/ecs"
        >
          <ArrowLeft className="size-4" />
          Back to ECS
        </Link>

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
                    <span className="size-2.5 rounded-full bg-[#20c997] shadow-[0_0_0_4px_rgba(32,201,151,0.14)]" />
                    {displayStatus(instance.status)}
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-2 break-words text-sm font-semibold text-[#475467]">
                  {instance.id}
                  <Copy className="size-3.5 text-[#667085]" />
                </p>
                <p className="mt-1 text-xs font-bold text-[#98a2b3]">
                  Showing {result.isCached ? "cached" : "fresh"} data from{" "}
                  <LocalDateTime value={result.updatedAt} />.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <EcsInstanceActions
                id={instance.id}
                projectId={instance.projectId}
                status={instance.status}
                variant="hero"
              />
              <RefreshButton />
              <EcsMoreMenu instance={instance} />
            </div>
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
